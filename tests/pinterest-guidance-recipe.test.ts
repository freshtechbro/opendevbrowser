import { describe, expect, it } from "vitest";
import { normalizePinterestReferenceUrl } from "../src/guidance/recipes/pinterest";
import {
  classifyPinterestCandidate,
  isCanonicalPinterestPinUrl
} from "../src/inspiredesign/pinterest-media-classification";
import {
  listSiteRecipes,
  resolveSiteRecipeForProvider,
  resolveSiteRecipeForUrl
} from "../src/guidance/recipes/site-registry";
import type { SiteRecipe } from "../src/guidance/types";
import { runBrowserNativeDiscovery } from "../src/providers/browser-native-discovery";
import { createProviderError } from "../src/providers/errors";
import type { NormalizedRecord, ProviderFailureEntry, ProviderReasonCode } from "../src/providers/types";

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
  it("canonicalizes accepted Pinterest references to HTTPS", () => {
    expect(normalizePinterestReferenceUrl("http://www.pinterest.com/pin/61572719900827789/?tracking=1#section")).toBe(
      "https://www.pinterest.com/pin/61572719900827789/"
    );
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/pin/create/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/pin/edit/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/pin/61572719900827789/edit/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/pin/61572719900827789/activity/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/pin/61572719900827789/settings/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/ideas/create/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/ideas/studio-lighting/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/ideas/studio-lighting/editorial/61572719900827789/")).toBe(
      "https://www.pinterest.com/ideas/studio-lighting/editorial/61572719900827789/"
    );
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/ideas/create/editorial/61572719900827789/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/ideas/studio-lighting/editorial/not-a-pin/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/pin/not-a-pin/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://uk.pinterest.com/studio/portrait-lighting/?tracking=1#section")).toBe(
      "https://uk.pinterest.com/studio/portrait-lighting/"
    );
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/settings/privacy/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/studio/created/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://www.pinterest.com/studio/_hidden/")).toBeNull();
    expect(normalizePinterestReferenceUrl("http://evil-pinterest.com/pin/61572719900827789/")).toBeNull();
  });

  it("classifies canonical Pinterest candidates and diagnostic surfaces", () => {
    expect(classifyPinterestCandidate({ url: "https://www.pinterest.com/pin/61572719900827789/" })).toEqual(expect.objectContaining({
      kind: "unknown_pin",
      productCandidate: false,
      sourcePageQuality: "unknown",
      diagnosticBlockers: expect.arrayContaining(["pin_media_type_unproven"])
    }));
    expect(classifyPinterestCandidate({ url: "https://www.pinterest.com/pin/61572719900827789/edit/" })).toEqual(expect.objectContaining({
      kind: "source_page",
      productCandidate: false,
      diagnosticBlockers: expect.arrayContaining(["source_page_requires_concrete_pin_extraction"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/61572719900827789/",
      html: "<img data-test-id=\"closeup-image\" src=\"pin.jpg\" alt=\"couture atelier drape\" />"
    })).toEqual(expect.objectContaining({
      kind: "image_pin",
      productCandidate: true,
      sourcePageQuality: "pin_media"
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/61572719900827789/",
      html: "<video src=\"pin.mp4\"></video>"
    })).toEqual(expect.objectContaining({
      kind: "video_pin",
      productCandidate: true,
      sourcePageQuality: "pin_media"
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/61572719900827789/",
      content: "Log in Sign up Continue with Google"
    })).toEqual(expect.objectContaining({
      kind: "login_challenge",
      productCandidate: false,
      sourcePageQuality: "login_challenge",
      diagnosticBlockers: expect.arrayContaining(["login_or_challenge_blocks_reference_extraction"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/61572719900827789/",
      title: "Sign in to Pinterest",
      html: "<video data-test-id=\"video\" src=\"pin.mp4\"></video>"
    })).toEqual(expect.objectContaining({
      kind: "login_challenge",
      productCandidate: false,
      sourcePageQuality: "login_challenge"
    }));
    expect(classifyPinterestCandidate({ url: "https://www.pinterest.com/studio/portrait-lighting/" })).toEqual(expect.objectContaining({
      kind: "board",
      productCandidate: false,
      diagnosticBlockers: expect.arrayContaining(["board_requires_concrete_media_extraction"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=studio",
      content: "Your profile Pin card When autocomplete results are available"
    })).toEqual(expect.objectContaining({
      kind: "shell",
      productCandidate: false,
      sourcePageQuality: "chrome_only",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=studio",
      content: "When autocomplete results are available use up and down arrows",
      html: "<picture><img src=\"/pin.jpg\"></picture>"
    })).toEqual(expect.objectContaining({
      kind: "shell",
      productCandidate: false,
      sourcePageQuality: "search_shell",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/61572719900827789/?query=video-pin",
      title: "Search results for studio video pin",
      content: "Related searches When autocomplete results are available pin card",
      html: '<div data-grid-item="true"><video data-test-id="video" src="pin.mp4"></video></div>'
    })).toEqual(expect.objectContaining({
      kind: "shell",
      productCandidate: false,
      sourcePageQuality: "search_shell",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=studio",
      content: "Your profile Updates Messages Settings & support",
      html: "<img src=\"/pin.jpg\">"
    })).toEqual(expect.objectContaining({
      kind: "shell",
      productCandidate: false,
      sourcePageQuality: "chrome_only",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/settings/privacy/",
      content: "Your profile Accounts Settings & support Search results for studio Pin card",
      html: '<nav>Settings & support</nav><main data-grid="search-results"><a href="/pin/61572719900827789/">Stale pin</a></main>'
    })).toEqual(expect.objectContaining({
      kind: "shell",
      productCandidate: false,
      sourcePageQuality: "chrome_only",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/pin/61572719900827789/?description=video+pin",
      title: "Video pin inspiration",
      content: "Watch this pin for video motion"
    })).toEqual(expect.objectContaining({
      kind: "unknown_pin",
      productCandidate: false,
      sourcePageQuality: "unknown",
      diagnosticBlockers: expect.arrayContaining(["pin_media_type_unproven"])
    }));
    expect(classifyPinterestCandidate({ url: "https://assets.pinterest.com/pin/61572719900827789/" })).toEqual(expect.objectContaining({
      kind: "invalid",
      productCandidate: false,
      sourcePageQuality: "invalid"
    }));
    expect(isCanonicalPinterestPinUrl("https://www.pinterest.com/pin/not-a-number/")).toBe(false);
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=studio",
      content: "Search results for studio /pin/61572719900827789/ When autocomplete results are available",
      html: "<div data-grid=\"search-results\"><img src=\"/pin.jpg\"></div>"
    })).toEqual(expect.objectContaining({
      kind: "shell",
      sourcePageQuality: "search_shell"
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=studio",
      content: "Your profile Search results for studio When autocomplete results are available",
      links: ["https://www.pinterest.com/pin/61572719900827789/"]
    })).toEqual(expect.objectContaining({
      kind: "shell",
      sourcePageQuality: "search_shell"
    }));
    expect(classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=studio",
      content: "Your profile Search results for studio /pin/61572719900827789/ When autocomplete results are available"
    })).toEqual(expect.objectContaining({
      kind: "shell",
      sourcePageQuality: "search_shell"
    }));
  });

  it("resolves Pinterest by provider id and host without registering a social provider", () => {
    expect(resolveSiteRecipeForProvider("social/pinterest")?.id).toBe("social/pinterest");
    expect(resolveSiteRecipeForUrl("https://uk.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/")?.id).toBe("social/pinterest");
    expect(resolveSiteRecipeForUrl("https://assets.pinterest.com/pin/61572719900827789/")).toBeUndefined();
    expect(resolveSiteRecipeForUrl("not a url")).toBeUndefined();
    expect(resolveSiteRecipeForProvider("social/not-pinterest")).toBeUndefined();

    const recipes = listSiteRecipes();
    recipes[0] = { ...recipes[0] as SiteRecipe, id: "mutated" };
    expect(listSiteRecipes()[0]?.id).toBe("social/pinterest");
    expect(Object.isFrozen(resolveSiteRecipeForProvider("social/pinterest"))).toBe(true);
    expect(Object.isFrozen(resolveSiteRecipeForProvider("social/pinterest")?.navigationSteps)).toBe(true);
  });

  it("documents authenticated canonical pin-media recovery without widening provider scope", () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const guidance = recipe.guidance;
    expect(guidance.primaryAction.summary).toContain("authenticated canonical pin media evidence");
    expect(guidance.fallbackPolicy.allowed).toBe(false);
    expect(guidance.fallbackPolicy.reason).toContain("unrelated web providers");
    expect(guidance.artifactInputs.map((input) => input.path)).toEqual(expect.arrayContaining([
      "ranked-references.json",
      "visual-evidence.json",
      "screenshot-index.json",
      "motion-evidence.json",
      "pin-media-evidence.json",
      "pin-media-index.json"
    ]));
    expect(guidance.artifactInputs.find((input) => input.path === "pin-media-evidence.json")?.purpose)
      .toContain("remote media URLs alone are not proof");
    expect(guidance.artifactInputs.find((input) => input.path === "pin-media-index.json")?.purpose)
      .toContain("manifest-backed");
    expect(guidance.validationChecks.map((check) => check.id)).toContain("pinterest-canonical-pin-media");
    expect(guidance.doNotProceedIf.join(" ")).toContain("search shell");
    expect(guidance.doNotProceedIf.join(" ")).toContain("login wall");
    expect(guidance.doNotProceedIf.join(" ")).toContain("board");
    expect(guidance.doNotProceedIf.join(" ")).toContain("source page");
    expect(guidance.doNotProceedIf.join(" ")).toContain("unrelated provider");
    expect(guidance.doNotProceedIf.join(" ")).toContain("pin-media-index.json");
    expect(recipe.recoverySteps.map((step) => step.id)).toEqual(expect.arrayContaining([
      "authenticate",
      "explicit-url",
      "pin-media-proof"
    ]));
    expect(recipe.recoverySteps.find((step) => step.id === "explicit-url")?.instruction)
      .toContain("canonical Pinterest pin URLs");
    expect(recipe.recoverySteps.find((step) => step.id === "explicit-url")?.instruction)
      .toContain("rather than boards");
    expect(recipe.badStates.find((state) => state.id === "search-shell")?.recoveryAction)
      .toBe("Open a concrete canonical pin before capture.");
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
      "https://www.pinterest.com/pin/61572719900827789/"
    ]);
    expect(result.diagnostics.reason).toBe("reference_urls_extracted");
  });

  it("uses hard failure reason codes from provider error details", async () => {
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
        records: [],
        failures: [{
          provider: "social/pinterest",
          source: "social",
          error: {
            code: "unavailable",
            message: "challenge from browser shell",
            retryable: true,
            details: { reasonCode: "challenge_detected" }
          }
        }]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.details?.reasonCode).toBe("challenge_detected");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "challenge_detected",
      fetchedRecordCount: 0,
      recoveryAction: "challenge from browser shell"
    }));
  });

  it("falls back to Pinterest classification blockers when recipe bad states are absent", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const recipeWithoutBadStates: SiteRecipe = { ...recipe, badStates: [] };
    const result = await runBrowserNativeDiscovery({
      recipe: recipeWithoutBadStates,
      query: "premium photography studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: undefined,
          content: "Sign in to continue with Pinterest before viewing pins"
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("auth_required");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      badStateId: "login",
      reason: "auth_required",
      sourcePageQuality: "login_challenge"
    }));
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

  it("extracts concrete pins from media-grid pages without shell markers", async () => {
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
          title: "Pinterest visual grid",
          content: '<a href="/pin/61572719900827789/">Studio reference</a>',
          attributes: {
            html: '<div data-test-id="pinWrapper"><a href="/pin/61572719900827789/"><img alt="Premium studio landing page pin" src="/studio.jpg"></a></div>'
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/"
    ]);
  });

  it("extracts canonical pins from rendered search-shell links", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest",
          content: "Search results for studio Pin card",
          attributes: {
            links: [
              "https://uk.pinterest.com/pin/11188699075430754/",
              "/pin/27654985208435505/",
              "https://example.com/not-pinterest"
            ]
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://uk.pinterest.com/pin/11188699075430754/",
      "https://www.pinterest.com/pin/27654985208435505/"
    ]);
    expect(result.records.map((record) => record.attributes)).toEqual([
      expect.objectContaining({
        discoveryMode: "browser_native_extracted_reference",
        pinterestSourcePageQuality: "search_shell"
      }),
      expect.objectContaining({
        discoveryMode: "browser_native_extracted_reference",
        pinterestSourcePageQuality: "search_shell"
      })
    ]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "reference_urls_extracted",
      sourcePageQuality: "search_shell",
      extractedUrlCount: 2
    }));
  });

  it("extracts canonical pins from search-shell link attributes and HTML anchors", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest",
          content: "Search results for studio Pin card",
          attributes: {
            links: [
              "https://uk.pinterest.com/pin/11188699075430754/",
              "https://example.com/not-pinterest"
            ],
            html: [
              '<a href="/pin/11111111111111111/edit/">Edit pin</a>',
              '<a href="/pin/22222222222222222/activity/">Pin activity</a>',
              '<a href="https://www.pinterest.com/pin/33333333333333333/settings/">Pin settings</a>',
              '<div data-grid-item="true"><a href="/pin/27654985208435505/"><img alt="Studio reference pin" src="/pin.jpg"></a></div>'
            ].join("")
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://uk.pinterest.com/pin/11188699075430754/",
      "https://www.pinterest.com/pin/27654985208435505/"
    ]);
    expect(result.records.map((record) => record.url)).not.toEqual(expect.arrayContaining([
      "https://www.pinterest.com/pin/11111111111111111/",
      "https://www.pinterest.com/pin/22222222222222222/",
      "https://www.pinterest.com/pin/33333333333333333/"
    ]));
    expect(result.records).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://example.com/not-pinterest" })
    ]));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "reference_urls_extracted",
      sourcePageQuality: "search_shell",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"]),
      extractedUrlCount: 2
    }));
  });

  it("extracts canonical pins from rendered search-result HTML when the record URL is malformed", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "not a valid pinterest search url",
          title: "Pinterest",
          content: "Search results for studio Pin card",
          attributes: {
            html: [
              '<main aria-label="search results">',
              '<a href="/pin/27654985208435505/">Studio reference pin</a>',
              "</main>"
            ].join("")
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/27654985208435505/"
    ]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "reference_urls_extracted",
      sourcePageQuality: "search_shell",
      extractedUrlCount: 1
    }));
  });

  it("extracts canonical pins from rendered search-result HTML when the record URL is absent", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: undefined,
          title: "Pinterest",
          content: "Search results for studio Pin card",
          attributes: {
            html: [
              '<main aria-label="search results">',
              '<a href="/pin/61572719900827789/">Studio reference pin</a>',
              "</main>"
            ].join("")
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/"
    ]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "reference_urls_extracted",
      sourcePageQuality: "search_shell",
      extractedUrlCount: 1
    }));
  });

  it("returns no records for pin-grid and non-search-shell Pinterest records with only board or idea links", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const runDiscovery = (record: NormalizedRecord) => runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [record],
        failures: []
      })
    });

    const pinGridResult = await runDiscovery(makeSearchRecord({
      title: "Pinterest visual grid",
      content: '<a href="/studio/portrait-lighting/">Board</a><a href="/ideas/web-design-parallax-scrolling/896364491640/">Idea</a>',
      attributes: {
        links: [
          "https://www.pinterest.com/studio/portrait-lighting/",
          "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/"
        ],
        html: '<div data-grid-item="true"><a href="/studio/portrait-lighting/">Board</a><a href="/ideas/web-design-parallax-scrolling/896364491640/">Idea</a></div>'
      }
    }));
    const nonSearchShellResult = await runDiscovery(makeSearchRecord({
      title: "Pinterest related visual references",
      content: '<a href="/studio/portrait-lighting/">Board</a><a href="/ideas/web-design-parallax-scrolling/896364491640/">Idea</a>',
      attributes: {
        links: [
          "https://www.pinterest.com/studio/portrait-lighting/",
          "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/"
        ]
      }
    }));

    expect(pinGridResult.records).toEqual([]);
    expect(nonSearchShellResult.records).toEqual([]);
    expect(pinGridResult.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(nonSearchShellResult.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(pinGridResult.diagnostics).toEqual(expect.objectContaining({
      reason: "no_reference_urls_extracted",
      fetchedRecordCount: 1
    }));
    expect(nonSearchShellResult.diagnostics).toEqual(expect.objectContaining({
      reason: "no_reference_urls_extracted",
      fetchedRecordCount: 1
    }));
  });

  it("returns only canonical pins when Pinterest discovery finds mixed pin, board, and idea links", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest mixed reference grid",
          content: '<a href="/studio/portrait-lighting/">Board</a><a href="/ideas/web-design-parallax-scrolling/896364491640/">Idea</a><a href="/pin/61572719900827789/?tracking=1">Pin</a>',
          attributes: {
            links: [
              "https://www.pinterest.com/studio/portrait-lighting/",
              "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/",
              "/pin/61572719900827789/?utm_source=search#comments",
              "https://uk.pinterest.com/pin/11188699075430754/"
            ],
            html: '<div data-grid-item="true"><a href="/pin/27654985208435505/">Third pin</a><a href="/studio/brand-systems/">Board</a></div>'
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/",
      "https://uk.pinterest.com/pin/11188699075430754/",
      "https://www.pinterest.com/pin/27654985208435505/"
    ]);
    expect(result.records).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://www.pinterest.com/studio/portrait-lighting/" }),
      expect.objectContaining({ url: "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/" })
    ]));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "reference_urls_extracted",
      extractedUrlCount: 3
    }));
  });

  it("does not borrow search-shell context from another record to extract stale pin links", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [
          makeSearchRecord({
            id: "search-shell-empty",
            content: "Search results for studio Pin card When autocomplete results are available"
          }),
          makeSearchRecord({
            id: "non-result-stale-pin",
            url: "https://www.pinterest.com/settings/privacy/",
            content: "Saved account link",
            attributes: {
              links: ["/pin/61572719900827789/"],
              html: '<aside><a href="/pin/61572719900827789/">Stale pin</a></aside>'
            }
          })
        ],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "env_limited",
      badStateId: "search-shell",
      sourcePageQuality: "chrome_only"
    }));
  });

  it("blocks chrome account surfaces with search markers and stale pin links", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [
          makeSearchRecord({
            title: "Pinterest account chrome",
            content: "Your profile Accounts Updates Messages",
            attributes: {
              html: "<nav>Settings & support</nav>"
            }
          }),
          makeSearchRecord({
            id: "search-shell-stale-pin",
            title: "Pinterest search shell",
            content: "Pin card Search results for studio When autocomplete results are available",
            attributes: {
              links: ["/pin/61572719900827789/"],
              html: '<article aria-label="Pin card"><a href="/pin/61572719900827789/">Stale pin</a></article>'
            }
          })
        ],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.failures[0]?.error.details).toEqual(expect.objectContaining({
      badStateId: "search-shell",
      sourcePageQuality: "chrome_only",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "env_limited",
      badStateId: "search-shell",
      sourcePageQuality: "chrome_only",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
  });

  it("blocks same-record chrome settings pages with search markers and stale rendered pins", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://www.pinterest.com/settings/privacy/",
          title: "Pinterest account settings",
          content: "Your profile Accounts Settings & support Search results for studio Pin card",
          attributes: {
            links: ["/pin/61572719900827789/"],
            html: [
              "<nav>Your profile Accounts Settings & support</nav>",
              '<main data-grid="search-results">Search results for studio Pin card ',
              '<a href="/pin/61572719900827789/">Stale settings pin</a>',
              "</main>"
            ].join("")
          }
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "env_limited",
      badStateId: "search-shell",
      sourcePageQuality: "chrome_only",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
  });

  it("blocks non-settings chrome surfaces with search-grid markers and stale rendered pins", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://www.pinterest.com/today/",
          title: "Pinterest home chrome",
          content: "Your profile Updates Messages Search results for studio Pin card",
          attributes: {
            links: ["/pin/61572719900827789/"],
            html: [
              "<nav>Your profile Updates Messages</nav>",
              '<main data-grid="search-results">Search results for studio Pin card ',
              '<a href="/pin/61572719900827789/">Stale home pin</a>',
              "</main>"
            ].join("")
          }
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "env_limited",
      badStateId: "search-shell",
      sourcePageQuality: "chrome_only",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
  });

  it("requires rendered pin link evidence before bypassing search-shell blockers", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest search shell",
          content: "Search results for studio Pin card /pin/61572719900827789/"
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "env_limited",
      badStateId: "search-shell",
      sourcePageQuality: "search_shell"
    }));
  });

  it("does not promote rendered pin links from records without source-page context", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: undefined,
          title: "Detached Pinterest reference",
          content: '<a href="/pin/61572719900827789/">Detached pin</a>',
          attributes: {
            html: '<article><a href="/pin/61572719900827789/">Detached pin</a></article>'
          }
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "no_reference_urls_extracted",
      fetchedRecordCount: 1
    }));
  });

  it("extracts canonical pins from signed-in search grids that include account chrome", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest search results",
          content: "Your profile Updates Messages Search results for studio Pin card",
          attributes: {
            links: [
              "/pin/61572719900827789/",
              "https://uk.pinterest.com/pin/11188699075430754/"
            ],
            html: [
              "<nav>Your profile Accounts Settings & support</nav>",
              '<main data-grid="search-results">',
              '<article aria-label="Pin card"><a href="/pin/61572719900827789/">Studio landing page</a></article>',
              '<article data-test-id="pinWrapper"><a href="https://uk.pinterest.com/pin/11188699075430754/">Editorial studio</a></article>',
              "</main>"
            ].join("")
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/",
      "https://uk.pinterest.com/pin/11188699075430754/"
    ]);
    expect(result.records.map((record) => record.attributes)).toEqual([
      expect.objectContaining({
        discoveryMode: "browser_native_extracted_reference",
        pinterestSourcePageQuality: "search_shell"
      }),
      expect.objectContaining({
        discoveryMode: "browser_native_extracted_reference",
        pinterestSourcePageQuality: "search_shell"
      })
    ]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "reference_urls_extracted",
      sourcePageQuality: "search_shell",
      extractedUrlCount: 2
    }));
  });

  it("does not promote discovery-only pin media text to captured pin-media source quality", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium design agency studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://www.pinterest.com/pin/33333333333333333/",
          title: "Pinterest pin image",
          content: "Pin media with a closeup image for a premium studio reference",
          attributes: {
            html: "<main><img data-test-id=\"closeup-image\" src=\"/pin.jpg\" alt=\"Premium studio reference\" /></main>"
          }
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/33333333333333333/"
    ]);
    expect(result.records[0]?.attributes).toEqual(expect.objectContaining({
      pinterestSourcePageQuality: "unknown"
    }));
    expect(result.records[0]?.attributes).not.toEqual(expect.objectContaining({
      pinterestSourcePageQuality: "pin_media"
    }));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "reference_urls_extracted",
      sourcePageQuality: "unknown"
    }));
  });

  it("keeps zero-URL search-shell pages diagnostic", async () => {
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
          content: "When autocomplete results are available use up and down arrows. Pin card",
          attributes: {
            links: ["https://example.com/not-pinterest"]
          }
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      badStateId: "search-shell",
      reason: "env_limited",
      sourcePageQuality: "search_shell",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
  });

  it("keeps login and challenge pages blocked when embedded links are present", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const cases = [
      {
        content: 'Log in to continue <a href="/pin/61572719900827789/">Decorative pin</a>',
        reasonCode: "auth_required",
        badStateId: "login"
      },
      {
        content: 'Captcha verification challenge <a href="/pin/61572719900827789/">Decorative pin</a>',
        reasonCode: "challenge_detected",
        badStateId: "challenge"
      }
    ] as const;

    for (const item of cases) {
      const result = await runBrowserNativeDiscovery({
        recipe,
        query: "premium photography studio landing page",
        maxReferences: 2,
        browserMode: "extension",
        useCookies: true,
        cookiePolicy: "required",
        fetchSearchPage: async () => ({
          records: [makeSearchRecord({
            title: "Pinterest blocker",
            content: item.content,
            attributes: {
              html: item.content
            }
          })],
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

  it("extracts only absolute www Pinterest pin URLs from browser HTML", async () => {
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
      "https://www.pinterest.com/pin/61572719900827789/"
    ]);
  });

  it("rejects profile chrome paths, boards, and dedupes tracked Pinterest pin references", async () => {
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
            '<a href="/board/settings/">Reserved board path</a>',
            '<a href="/studio/portrait-lighting/?utm_source=search#section">Board</a>',
            '<a href="https://www.pinterest.com/studio/portrait-lighting/?tracking=1">Tracked duplicate</a>',
            '<a href="/pin/61572719900827789/?utm_source=search#comments">Pin</a>'
          ].join("")
        })],
        failures: []
      })
    });

    expect(result.records.map((record) => record.url)).toEqual([
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

  it("keeps search-shell failures diagnostic even when visible canonical pins exist", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const failure = makeFailure("env_limited", "Pinterest shell rendered with incomplete provider context.");

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest search shell",
          content: "Search results for studio Pin card",
          attributes: {
            links: ["/pin/61572719900827789/"],
            html: '<article aria-label="Pin card"><a href="/pin/61572719900827789/">Visible pin</a></article>'
          }
        })],
        failures: [failure]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([failure]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      attempted: true,
      reason: "env_limited",
      fetchedRecordCount: 1,
      sourcePageQuality: "search_shell",
      diagnosticBlockers: expect.arrayContaining(["search_shell_without_media_signals"])
    }));
  });

  it.each<ProviderReasonCode>([
    "auth_required",
    "challenge_detected",
    "policy_blocked",
    "rate_limited",
    "token_required"
  ])("uses hard-failure details when upstream failures also expose env-limited top-level reason codes: %s", async (reasonCode) => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const failure = makeFailure("env_limited", "Complete the browser challenge before continuing.");
    const detailsOnlyHardFailure: ProviderFailureEntry = {
      ...failure,
      error: {
        ...failure.error,
        details: {
          ...failure.error.details,
          reasonCode
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
        failures: [detailsOnlyHardFailure]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([detailsOnlyHardFailure]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: reasonCode,
      fetchedRecordCount: 1
    }));
  });

  it("preserves upstream hard failures before extracting embedded Pinterest links", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const cases = [
      "auth_required",
      "challenge_detected",
      "policy_blocked",
      "rate_limited",
      "token_required"
    ] as const;

    for (const reasonCode of cases) {
      const failure = makeFailure(reasonCode, `${reasonCode} blocks discovery.`);
      const result = await runBrowserNativeDiscovery({
        recipe,
        query: "cinematic photography studio",
        maxReferences: 2,
        browserMode: "extension",
        useCookies: true,
        cookiePolicy: "required",
        fetchSearchPage: async () => ({
          records: [makeSearchRecord({
            content: '<a href="/pin/61572719900827789/">Stale pin</a>',
            attributes: {
              html: '<a href="/pin/61572719900827789/">Stale pin</a>'
            }
          })],
          failures: [failure]
        })
      });

      expect(result.records).toEqual([]);
      expect(result.failures).toEqual([failure]);
      expect(result.diagnostics).toEqual(expect.objectContaining({
        reason: reasonCode,
        fetchedRecordCount: 1
      }));
    }
  });

  it("fails closed on search-shell records when upstream failures are not normalized", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const unnormalizedFailure: ProviderFailureEntry = {
      provider: "social/pinterest",
      source: "social",
      error: {
        code: "auth",
        message: "Authentication gate blocked search discovery before normalization.",
        retryable: true,
        provider: "social/pinterest",
        source: "social"
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
          title: "Pinterest search shell",
          content: "Search results for studio Pin card",
          attributes: {
            links: ["/pin/61572719900827789/"],
            html: '<article aria-label="Pin card"><a href="/pin/61572719900827789/">Stale pin</a></article>'
          }
        })],
        failures: [unnormalizedFailure]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([unnormalizedFailure]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "token_required",
      fetchedRecordCount: 1
    }));
  });

  it("preserves unnormalized auth failures before extracting non-search-shell embedded Pinterest links", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const unnormalizedFailure: ProviderFailureEntry = {
      provider: "social/pinterest",
      source: "social",
      error: {
        code: "auth",
        message: "Authentication gate blocked search discovery before normalization.",
        retryable: true,
        provider: "social/pinterest",
        source: "social"
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
          title: "Pinterest visual grid",
          content: '<a href="/pin/61572719900827789/">Stale pin</a>',
          attributes: {
            links: ["/pin/61572719900827789/"],
            html: '<div data-grid-item="true"><a href="/pin/61572719900827789/">Stale pin</a></div>'
          }
        })],
        failures: [unnormalizedFailure]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([unnormalizedFailure]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "token_required",
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

  it("rejects non-concrete Pinterest pin, idea, and product chrome paths from direct candidate URLs", async () => {
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
          makeSearchRecord({ url: "https://www.pinterest.com/pin/create/" }),
          makeSearchRecord({ url: "https://www.pinterest.com/pin/edit/" }),
          makeSearchRecord({ url: "https://www.pinterest.com/ideas/" }),
          makeSearchRecord({ url: "https://www.pinterest.com/ideas/create/" }),
          makeSearchRecord({ url: "https://www.pinterest.com/create/pin/" }),
          makeSearchRecord({ url: "https://www.pinterest.com/explore/design/" })
        ],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.diagnostics.reason).toBe("no_reference_urls_extracted");
  });

  it("rejects spoofed and unapproved Pinterest hosts with the default extraction message", async () => {
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
          url: "https://assets.pinterest.com/pin/61572719900827789/",
          content: "https://notpinterest.com/pin/61572719900827789/ https://assets.pinterest.com/pin/61572719900827789/"
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.message).toBe("social/pinterest search did not expose recipe-approved URLs that can be used as references.");
  });

  it("rejects non-http Pinterest URLs from direct candidate records", async () => {
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
          url: "ftp://www.pinterest.com/pin/61572719900827789/"
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.diagnostics.reason).toBe("no_reference_urls_extracted");
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

  it("blocks Pinterest source extraction when classification detects chrome without recipe marker text", async () => {
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
          content: "Accounts",
          attributes: {
            html: '<a href="/pin/61572719900827789/">Studio pin</a>'
          }
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.details).toEqual(expect.objectContaining({
      badStateId: "search-shell",
      sourcePageQuality: "chrome_only"
    }));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      badStateId: "search-shell",
      sourcePageQuality: "chrome_only"
    }));
  });

  it("synthesizes login recovery when Pinterest classification blocks extraction without recipe bad states", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const recipeWithoutBadStates: SiteRecipe = {
      ...recipe,
      badStates: []
    };

    const result = await runBrowserNativeDiscovery({
      recipe: recipeWithoutBadStates,
      query: "cinematic photography studio",
      maxReferences: 1,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://www.pinterest.com/search/pins/?q=studio",
          content: "Continue with Google to see this pin.",
          attributes: {
            html: '<a href="/pin/61572719900827789/">Studio pin</a>'
          }
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.details).toEqual(expect.objectContaining({
      badStateId: "login",
      sourcePageQuality: "login_challenge"
    }));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "auth_required",
      badStateId: "login",
      sourcePageQuality: "login_challenge",
      recoveryAction: "Use extension mode with a user-authorized logged-in Pinterest session."
    }));
  });

  it("synthesizes search-shell recovery when classification blocks extraction without recipe bad states", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const recipeWithoutBadStates: SiteRecipe = {
      ...recipe,
      badStates: []
    };

    const result = await runBrowserNativeDiscovery({
      recipe: recipeWithoutBadStates,
      query: "cinematic photography studio",
      maxReferences: 1,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://www.pinterest.com/search/pins/?q=studio",
          content: "Search results for studio When autocomplete results are available",
          attributes: {
            links: ["https://example.com/not-pinterest"]
          }
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.details).toEqual(expect.objectContaining({
      badStateId: "search-shell",
      sourcePageQuality: "search_shell"
    }));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "env_limited",
      badStateId: "search-shell",
      sourcePageQuality: "search_shell",
      recoveryAction: "Open a concrete pin, board, or idea page before capture."
    }));
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
