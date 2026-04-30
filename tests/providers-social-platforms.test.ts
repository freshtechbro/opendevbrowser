import { describe, expect, it, vi } from "vitest";
import { createSocialProvider, createSocialProviders, type SocialPlatform } from "../src/providers/social";
import { createDefaultRuntime } from "../src/providers";
import { ProviderRuntimeError } from "../src/providers/errors";
import type { ProviderAdapter } from "../src/providers/types";

const providers: ProviderAdapter[] = createSocialProviders();
const platforms: SocialPlatform[] = ["x", "reddit", "bluesky", "facebook", "linkedin", "instagram", "tiktok", "threads", "youtube"];

const context = (requestId: string) => ({
  trace: { requestId, ts: new Date().toISOString() },
  timeoutMs: 50,
  attempt: 1 as const
});

describe("social platform adapters", () => {
  it("uses real retrieval defaults in createDefaultRuntime social path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return {
        status: 200,
        url,
        text: async () => `<html><body><main>social content ${url}</main><a href="https://x.com/acct/status/2">post</a></body></html>`
      };
    }) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "release", limit: 3 },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(0);
      expect(result.records[0]?.provider).toBe("social/x");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds youtube social search URLs and ignores malformed extracted links", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return {
        status: 200,
        url,
        text: async () => [
          "<html><body>",
          "<main>youtube social search</main>",
          "<a href=\"http://[\">bad</a>",
          "<a href=\"/watch?v=123\">good</a>",
          "</body></html>"
        ].join("")
      };
    }) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 3 },
        { source: "social", providerIds: ["social/youtube"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(0);
      expect(result.records[0]?.provider).toBe("social/youtube");
      expect(result.records[0]?.url).toBe("https://www.youtube.com/watch?v=123");
      expect(result.records[0]?.attributes.links).toEqual([
        "https://www.youtube.com/watch?v=123"
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("times out social retrieval when the response body never resolves after headers arrive", async () => {
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => await new Promise<string>(() => undefined),
      body: {
        cancel
      }
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        budgets: {
          timeoutMs: {
            search: 25,
            fetch: 25,
            crawl: 25,
            post: 25
          }
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 3 },
        { source: "social", providerIds: ["social/facebook"] }
      );

      expect(result.ok).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error.code).toBe("timeout");
      expect(result.failures[0]?.error.message).toContain("25ms");
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses browser retrieval for auth-blocked extension-first social defaults including reddit", async () => {
    const recoveredHtmlByProvider: Record<string, string> = {
      "social/x": `<html><body><main><article><a href="https://x.com/acct/status/123">Recovered X result</a></article></main></body></html>`,
      "social/bluesky": `<html><body><main><article><a href="https://bsky.app/profile/alice.bsky.app/post/123">Recovered Bluesky result</a></article></main></body></html>`,
      "social/reddit": `<html><body><main><article><a href="https://www.reddit.com/r/browserautomation/comments/abc123/runtime_fix/">Recovered Reddit result</a></article></main></body></html>`,
      "social/facebook": `<html><body><main><a href="https://www.facebook.com/watch/?v=123456789012345">Recovered Facebook video</a></main></body></html>`,
      "social/linkedin": `<html><body><main><a href="https://www.linkedin.com/feed/update/urn:li:activity:123">Recovered LinkedIn result</a></main></body></html>`,
      "social/threads": `<html><body><main><a href="https://www.threads.net/@opendevbrowser/post/ABC123">Recovered Threads result</a></main></body></html>`
    };
    const fallbackResolve = vi.fn(async (request: {
      provider?: string;
      reasonCode: "token_required" | "auth_required" | "challenge_detected" | "rate_limited" | "env_limited" | "ip_blocked";
      url?: string;
      runtimePolicy?: { browser?: { preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: request.runtimePolicy?.browser?.preferredModes?.[0] === "extension"
        ? "extension" as const
        : "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.facebook.com/watch/search/?q=browser%20automation",
        html: recoveredHtmlByProvider[request.provider ?? ""] ?? "<html><body>unexpected social fallback</body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 403,
      url: String(input),
      text: async () => "<html><body>auth wall</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });

      const authBlockedProviders = [
        "social/x",
        "social/reddit",
        "social/bluesky",
        "social/facebook",
        "social/linkedin",
        "social/threads"
      ];

      for (const providerId of authBlockedProviders) {
        const result = await runtime.search(
          { query: "browser automation", limit: 3, filters: { hopLimit: 0, expansionPerRecord: 0 } },
          { source: "social", providerIds: [providerId] }
        );
        expect(result.ok, providerId).toBe(true);
        expect(result.failures).toHaveLength(0);
      }

      expect(fallbackResolve).toHaveBeenCalled();
      const providers = fallbackResolve.mock.calls
        .map((call) => call[0]?.provider)
        .filter((provider): provider is string => typeof provider === "string");
      expect(providers).toEqual(expect.arrayContaining(authBlockedProviders));

      const fallbackCalls = new Map(
        fallbackResolve.mock.calls
          .map(([request]) => [request?.provider, request] as const)
          .filter((
            entry
          ): entry is readonly [string, { runtimePolicy?: { browser?: { preferredModes?: string[] } } }] => typeof entry[0] === "string")
      );
      expect(fallbackCalls.get("social/x")?.runtimePolicy?.browser?.preferredModes).toEqual(["extension", "managed_headed"]);
      expect(fallbackCalls.get("social/bluesky")?.runtimePolicy?.browser?.preferredModes).toEqual(["extension", "managed_headed"]);
      expect(fallbackCalls.get("social/facebook")?.runtimePolicy?.browser?.preferredModes).toEqual(["extension", "managed_headed"]);
      expect(fallbackCalls.get("social/linkedin")?.runtimePolicy?.browser?.preferredModes).toEqual(["extension", "managed_headed"]);
      expect(fallbackCalls.get("social/reddit")?.runtimePolicy?.browser?.preferredModes).toEqual(["extension", "managed_headed"]);

      const fallbackCount = fallbackResolve.mock.calls.length;
      for (const providerId of ["social/instagram", "social/tiktok"]) {
        const result = await runtime.search(
          { query: "browser automation", limit: 3, filters: { hopLimit: 0, expansionPerRecord: 0 } },
          { source: "social", providerIds: [providerId] }
        );
        expect(result.ok, providerId).toBe(false);
        expect(result.failures[0]?.error.code).toBe("auth");
      }
      expect(fallbackResolve).toHaveBeenCalledTimes(fallbackCount);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps recovered facebook search rows when the browser page is populated but exposes no concrete content links", async () => {
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      url?: string;
      runtimePolicy?: { browser?: { preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.facebook.com/watch/search/?q=browser%20automation%20facebook&page=1",
        html: [
          "<html><body><main>",
          "<h1>Top browser automation facebook videos</h1>",
          "<p>Shared with Public</p>",
          "<button>Open reel in Reels Viewer</button>",
          "<a href=\"/BradfordSCarlton\">Dr. Bradford Carlton</a>",
          "<a href=\"/prince.okporu\">Prince Joseph Okporu</a>",
          "</main></body></html>"
        ].join("")
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 403,
      url: String(input),
      text: async () => "<html><body>auth wall</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation facebook", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/facebook"] }
      );

      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        provider: "social/facebook",
        url: "https://www.facebook.com/watch/search?page=1&q=browser+automation+facebook",
        attributes: {
          retrievalPath: "social:search:index",
          browser_fallback_mode: "extension",
          browser_fallback_reason_code: "token_required",
          links: []
        }
      });
      expect(result.records[0]?.content).toContain("Top browser automation facebook videos");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps recovered facebook search rows when expansion links exist but the downstream fetches are skipped", async () => {
    const provider = createSocialProvider("facebook", {
      search: async () => [{
        url: "https://www.facebook.com/watch/search/?q=browser%20automation%20facebook&page=1",
        title: "facebook search: browser automation facebook",
        content: [
          "Top browser automation facebook videos",
          "Search results",
          "Shared with Public",
          "Open reel in Reels Viewer"
        ].join(" "),
        attributes: {
          browser_fallback_mode: "extension",
          browser_fallback_reason_code: "token_required",
          links: [
            "https://www.facebook.com/watch/?ref=search&v=928712426880997&q=browser%20automation%20facebook"
          ]
        }
      }],
      fetch: async () => {
        throw new ProviderRuntimeError("auth", "Facebook expansion requires authentication", {
          provider: "social/facebook",
          source: "social",
          retryable: false
        });
      }
    });

    const result = await provider.search(
      { query: "browser automation facebook", limit: 5, filters: { pageLimit: 1 } },
      context("facebook-search-fallback-row-with-links")
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "social/facebook",
      url: "https://www.facebook.com/watch/search?page=1&q=browser+automation+facebook",
      attributes: {
        browser_fallback_mode: "extension",
        browser_fallback_reason_code: "token_required",
        links: [
          "https://www.facebook.com/watch/?ref=search&v=928712426880997&q=browser%20automation%20facebook"
        ]
      }
    });
    expect(result[0]?.content).toContain("Top browser automation facebook videos");
  });

  it("classifies 200 auth-wall social search pages before traversal rows are returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign in | LinkedIn</title></head><body>Please sign in to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 3 },
        { source: "social", providerIds: ["social/linkedin"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toMatchObject({
        code: "auth",
        reasonCode: "token_required",
        details: {
          blockerType: "auth_required",
          constraint: {
            kind: "session_required",
            evidenceCode: "auth_required"
          }
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to browser retrieval for 200 auth-wall social pages when browser fallback is available", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string; preferredModes?: string[] }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
        html: "<html><body><main>fallback social content</main><a href=\"https://www.linkedin.com/feed/update/urn:li:activity:1\">post</a></body></html>"
      },
      details: {}
    }));

    const fetchSpy = vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign in | LinkedIn</title></head><body>Please sign in to continue.</body></html>"
    }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        { source: "social", providerIds: ["social/linkedin"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(0);
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/linkedin",
        reasonCode: "token_required",
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["extension", "managed_headed"],
            forceTransport: false
          }
        })
      }));
      expect(fallbackResolve.mock.calls.length).toBeLessThanOrEqual(2);
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves helper execution metadata on successful linkedin browser fallback recovery", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string; preferredModes?: string[] }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
        html: "<html><body><main>fallback social content</main></body></html>"
      },
      details: {
        cookieDiagnostics: {
          available: true,
          verifiedCount: 2
        },
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        }
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign in | LinkedIn</title></head><body>Please sign in to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        { source: "social", providerIds: ["social/linkedin"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records[0]?.attributes).toMatchObject({
        browser_fallback_mode: "extension",
        browser_fallback_reason_code: "token_required",
        browser_fallback_cookie_diagnostics: {
          available: true,
          verifiedCount: 2
        },
        browser_fallback_challenge_orchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves browser fallback metadata when linkedin recovery completes but the auth wall remains", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string; preferredModes?: string[] }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.linkedin.com/search/results/content/?keywords=browser%20automation&page=1",
        html: "<html><head><title>Sign in | LinkedIn</title></head><body>Please sign in to continue.</body></html>"
      },
      details: {
        cookieDiagnostics: {
          available: true,
          verifiedCount: 2
        },
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        }
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign in | LinkedIn</title></head><body>Please sign in to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });

      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        { source: "social", providerIds: ["social/linkedin"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error.details).toMatchObject({
        browserFallbackMode: "extension",
        cookieDiagnostics: {
          available: true,
          verifiedCount: 2
        },
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces non-completed linkedin fallback dispositions as provider failures", async () => {
    const fallbackResolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "token_required" as const,
      disposition: "challenge_preserved" as const,
      details: {
        message: "Browser fallback preserved a challenge session for LinkedIn."
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign in | LinkedIn</title></head><body>Please sign in to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        { source: "social", providerIds: ["social/linkedin"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toMatchObject({
        code: "auth",
        reasonCode: "token_required",
        message: "Browser fallback preserved a challenge session for LinkedIn.",
        details: {
          disposition: "challenge_preserved"
        }
      });
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/linkedin",
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["extension", "managed_headed"],
            forceTransport: false
          }
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces linkedin browser fallback timeouts as provider timeout failures", async () => {
    const fallbackResolve = vi.fn(async () => {
      throw new ProviderRuntimeError("timeout", "Browser fallback timed out after 25ms", {
        provider: "social/linkedin",
        source: "social",
        retryable: true,
        details: {
          stage: "challenge_orchestration",
          timeoutMs: 25
        }
      });
    });

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign in | LinkedIn</title></head><body>Please sign in to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        { source: "social", providerIds: ["social/linkedin"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toMatchObject({
        code: "timeout",
        message: "Browser fallback timed out after 25ms",
        details: {
          stage: "challenge_orchestration",
          timeoutMs: 25
        }
      });
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/linkedin",
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["extension", "managed_headed"],
            forceTransport: false
          }
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies X javascript-required search shells as render-required env-limited failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>X</title></head><body>JavaScript is disabled in this browser. Please enable JavaScript.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error).toMatchObject({
        reasonCode: "env_limited",
        details: {
          providerShell: "social_js_required_shell",
          blockerType: "env_limited",
          constraint: {
            kind: "render_required",
            evidenceCode: "social_js_required_shell"
          }
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps usable X result links while omitting first-party search seed rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>(1) browser automation x - Search / X</title></head><body>",
        "<main>",
        "<p>JavaScript is disabled in this browser. Please enable JavaScript.</p>",
        "<nav><a href=\"/search?q=browser+automation&f=live\">Top</a><a href=\"/search?q=browser+automation&f=live\">Latest</a></nav>",
        "<article><a href=\"https://x.com/i/web/status/1\">A real X post about browser automation</a></article>",
        "<article><a href=\"https://x.com/i/web/status/1/analytics\">Analytics</a></article>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.records.map((record) => record.url)).toEqual(["https://x.com/i/web/status/1"]);
      expect(result.records[0]?.attributes.links).not.toContain("https://x.com/search?f=live&page=1&q=browser+automation");
      expect(result.records[0]?.attributes.links).not.toContain("https://x.com/i/web/status/1/analytics");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps late-position X result links inside truncated search record attributes", async () => {
    const fillerLinks = Array.from({ length: 24 }, (_, index) => `https://docs.example.com/browser-automation-${index + 1}`);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>(1) browser automation x - Search / X</title></head><body>",
        "<main>",
        "<p>JavaScript is disabled in this browser. Please enable JavaScript.</p>",
        ...fillerLinks.map((link, index) => `<a href="${link}">Filler ${index + 1}</a>`),
        "<article><a href=\"https://x.com/acct/status/999\">Late X result</a></article>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.map((record) => record.url)).toEqual(["https://x.com/acct/status/999"]);
      expect(result.records[0]?.attributes).toMatchObject({
        retrievalPath: "social:search:index",
        links: ["https://x.com/acct/status/999"]
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps X javascript-required search shells blocked when only policy and help links are present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>(1) browser automation x - Search / X</title></head><body>",
        "<main>",
        "<p>JavaScript is disabled in this browser. Please enable JavaScript.</p>",
        "<a href=\"https://x.com/privacy\">Privacy</a>",
        "<a href=\"https://x.com/tos\">Terms</a>",
        "<a href=\"https://t.co\">Shortener</a>",
        "<a href=\"https://help.x.com/using-x/x-supported-browsers\">Help</a>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.details).toMatchObject({
        providerShell: "social_js_required_shell"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps X javascript-required shells blocked when only first-party metadata links are present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>(1) browser automation x - Search / X</title></head><body>",
        "<main>",
        "<p>JavaScript is not available. We’ve detected that JavaScript is disabled in this browser.</p>",
        "<a href=\"https://x.com/os-x.xml\">OpenSearch</a>",
        "<a href=\"https://x.com/manifest.json\">Manifest</a>",
        "<a href=\"https://x.com/os-grok.xml\">Grok OpenSearch</a>",
        "<a href=\"https://help.x.com/using-x/x-supported-browsers\">Help</a>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.details).toMatchObject({
        providerShell: "social_js_required_shell"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("recovers X javascript-required search shells through extension-first browser fallback and preserves fallback metadata", async () => {
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      url?: string;
      runtimePolicy?: { browser?: { preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: request.runtimePolicy?.browser?.preferredModes?.[0] === "extension"
        ? "extension" as const
        : "managed_headed" as const,
      output: {
        url: request.url ?? "https://x.com/search?q=browser%20automation&f=live&page=1",
        html: "<html><body><main><article><a href=\"https://x.com/acct/status/999\">X fallback content</a></article></main></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>X</title></head><body>JavaScript is disabled in this browser. Please enable JavaScript.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.records[0]?.url).toBe("https://x.com/acct/status/999");
      expect(result.records[0]?.attributes).toMatchObject({
        retrievalPath: "social:search:index",
        links: ["https://x.com/acct/status/999"],
        browser_fallback_mode: "extension",
        browser_fallback_reason_code: "env_limited"
      });
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/x",
        reasonCode: "env_limited",
        url: "https://x.com/search?f=live&page=1&q=browser+automation",
        runtimePolicy: expect.objectContaining({
          browser: expect.objectContaining({
            preferredModes: ["extension", "managed_headed"]
          })
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses direct extension transport for X searches when browser mode is forced", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: "https://x.com/search?q=browser+automation",
      text: async () => "<html><body><article><a href=\"https://x.com/loggedout/status/1\">logged out shell</a></article></body></html>"
    })) as unknown as typeof fetch;
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      url?: string;
      runtimePolicy?: { browser?: { forceTransport?: boolean; preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://x.com/search?q=browser+automation",
        html: "<html><body><article><a href=\"https://x.com/acct/status/999\">X signed-in content</a></article></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", fetchMock);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        {
          source: "social",
          providerIds: ["social/x"],
          runtimePolicy: {
            browserMode: "extension",
            useCookies: true,
            cookiePolicyOverride: "required"
          }
        }
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/x",
        reasonCode: "auth_required",
        runtimePolicy: expect.objectContaining({
          browser: expect.objectContaining({
            forceTransport: true,
            preferredModes: ["extension"]
          })
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails forced X browser transport when no browser transport is available", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: "https://x.com/search?q=browser+automation",
      text: async () => "<html><body>direct search should not run</body></html>"
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        {
          source: "social",
          providerIds: ["social/x"],
          runtimePolicy: {
            browserMode: "extension",
            useCookies: true,
            cookiePolicyOverride: "required"
          }
        }
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.failures[0]?.error).toMatchObject({
        code: "auth",
        reasonCode: "auth_required",
        details: {
          browserTransportRequired: true
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("propagates forced X browser transport blockers without falling back to raw fetch", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: "https://x.com/search?q=browser+automation",
      text: async () => "<html><body>direct search should not run</body></html>"
    })) as unknown as typeof fetch;
    const fallbackResolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "challenge_detected" as const,
      mode: "extension" as const,
      details: {
        message: "X preserved an interactive verification challenge."
      }
    }));

    vi.stubGlobal("fetch", fetchMock);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        {
          source: "social",
          providerIds: ["social/x"],
          runtimePolicy: {
            browserMode: "extension",
            useCookies: true,
            cookiePolicyOverride: "required"
          }
        }
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.failures[0]?.error).toMatchObject({
        code: "unavailable",
        reasonCode: "challenge_detected",
        message: "X preserved an interactive verification challenge.",
        details: {
          disposition: "failed",
          browserFallbackMode: "extension"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses direct extension transport for YouTube searches when browser mode is forced", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/results?search_query=browser+automation",
      text: async () => "<html><body><main>direct search should not run</main></body></html>"
    })) as unknown as typeof fetch;
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      url?: string;
      runtimePolicy?: { browser?: { forceTransport?: boolean; preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/results?search_query=browser+automation",
        html: `<html><body><script>{"videoId":"abc123def45","title":{"runs":[{"text":"Signed-in YouTube result"}]}}</script></body></html>`
      },
      details: {}
    }));

    vi.stubGlobal("fetch", fetchMock);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        {
          source: "social",
          providerIds: ["social/youtube"],
          runtimePolicy: {
            browserMode: "extension",
            useCookies: true,
            cookiePolicyOverride: "required"
          }
        }
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.records[0]?.url).toBe("https://www.youtube.com/watch?v=abc123def45");
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/youtube",
        reasonCode: "auth_required",
        runtimePolicy: expect.objectContaining({
          browser: expect.objectContaining({
            forceTransport: true,
            preferredModes: ["extension"]
          })
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses env_limited for forced public YouTube extension transport without required cookies", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/results?search_query=browser+automation",
      text: async () => "<html><body><main>direct search should not run</main></body></html>"
    })) as unknown as typeof fetch;
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/results?search_query=browser+automation",
        html: `<html><body><script>{"videoId":"abc123def45","title":{"runs":[{"text":"Public YouTube result"}]}}</script></body></html>`
      },
      details: {}
    }));

    vi.stubGlobal("fetch", fetchMock);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: { resolve: fallbackResolve }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        {
          source: "social",
          providerIds: ["social/youtube"],
          runtimePolicy: { browserMode: "extension" }
        }
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.records[0]?.attributes.browser_fallback_reason_code).toBe("env_limited");
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/youtube",
        reasonCode: "env_limited"
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves X search-route semantics when fallback capture url drifts away from the search route", async () => {
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      runtimePolicy?: { browser?: { preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: request.runtimePolicy?.browser?.preferredModes?.[0] === "extension"
        ? "extension" as const
        : "managed_headed" as const,
      output: {
        url: "https://x.com/home",
        html: "<html><body><main><article><a href=\"/i/web/status/999\">Recovered X status</a></article></main></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/i/web/status/999")) {
        return {
          status: 200,
          url,
          text: async () => "<html><body><article>Expanded X fallback status</article></body></html>"
        };
      }
      return {
        status: 200,
        url,
        text: async () => "<html><head><title>X</title></head><body>JavaScript is disabled in this browser. Please enable JavaScript.</body></html>"
      };
    }) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.records.map((record) => record.url)).toEqual(["https://x.com/i/web/status/999"]);
      expect(result.records[0]?.attributes).toMatchObject({
        query: "browser automation",
        retrievalPath: "social:search:index",
        browser_fallback_mode: "extension",
        browser_fallback_reason_code: "env_limited"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not preserve the X search route when recovered fallback links are not usable results", async () => {
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      runtimePolicy?: { browser?: { preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: request.runtimePolicy?.browser?.preferredModes?.[0] === "extension"
        ? "extension" as const
        : "managed_headed" as const,
      output: {
        url: "https://x.com/home",
        html: [
          "<html><body><main>Recovered X landing page</main>",
          "<a href=\"https://x.com/privacy\">Privacy</a>",
          "<a href=\"https://help.x.com/using-x/x-supported-browsers\">Help</a>",
          "</body></html>"
        ].join("")
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>X</title></head><body>JavaScript is disabled in this browser. Please enable JavaScript.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.details).toMatchObject({
        url: "https://x.com/home",
        browserFallbackReasonCode: "env_limited"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies Bluesky javascript-required search shells as render-required env-limited failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Bluesky</title></head><body>Bluesky JavaScript Required</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/bluesky"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error).toMatchObject({
        reasonCode: "env_limited",
        details: {
          providerShell: "social_js_required_shell",
          blockerType: "env_limited",
          constraint: {
            kind: "render_required",
            evidenceCode: "social_js_required_shell"
          }
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps usable Bluesky result links while omitting first-party search seed rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>Bluesky Search</title></head><body>",
        "<main>",
        "<p>Bluesky JavaScript Required</p>",
        "<nav><a href=\"/search?q=browser+automation\">Top</a></nav>",
        "<article><a href=\"https://bsky.app/profile/acct/post/1\">A real Bluesky post about browser automation</a></article>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/bluesky"] }
      );

      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.records.map((record) => record.url)).toEqual(["https://bsky.app/profile/acct/post/1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps logged-out Bluesky search shells blocked when only feed and help links are present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>Explore - Bluesky</title></head><body>",
        "<main>",
        "<p>Search is currently unavailable when logged out</p>",
        "<p>Bluesky JavaScript Required</p>",
        "<a href=\"https://bsky.app/profile/trending.bsky.app/feed/665497821\">Trending feed</a>",
        "<a href=\"https://blueskyweb.zendesk.com/hc/en-us\">Help</a>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/bluesky"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.details).toMatchObject({
        providerShell: "social_js_required_shell"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps signed-in Bluesky empty search shells blocked when only shell navigation and profile links are present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>bluesky search: browser automation bluesky</title></head><body>",
        "<main>",
        "<p>All languages Top Latest People Feeds Home Explore Notifications Chat Feeds Lists Saved Profile Settings New Post Discover Following Video More feeds</p>",
        "<p>Follow 10 people to get started Find people to follow Trending 1. 2. 3. 4. 5.</p>",
        "<a href=\"https://bsky.app/notifications\">Notifications</a>",
        "<a href=\"https://bsky.app/messages\">Messages</a>",
        "<a href=\"https://bsky.app/feeds\">Feeds</a>",
        "<a href=\"https://bsky.app/lists\">Lists</a>",
        "<a href=\"https://bsky.app/saved\">Saved</a>",
        "<a href=\"https://bsky.app/profile/freshtechbro.bsky.social\">Profile</a>",
        "<a href=\"https://bsky.app/settings\">Settings</a>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/bluesky"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.details).toMatchObject({
        providerShell: "social_render_shell",
        constraint: {
          kind: "render_required",
          evidenceCode: "social_render_shell"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps signed-in Bluesky navigation-only search shells blocked when only profile and shell navigation links are present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><head><title>bluesky search: browser automation bluesky</title></head><body>",
        "<main>",
        "<p>All languages Top Latest People Feeds Home Explore Notifications Chat Feeds Lists Saved Profile Settings New Post Feedback Privacy Terms Help</p>",
        "<a href=\"https://bsky.app/notifications\">Notifications</a>",
        "<a href=\"https://bsky.app/messages\">Messages</a>",
        "<a href=\"https://bsky.app/feeds\">Feeds</a>",
        "<a href=\"https://bsky.app/lists\">Lists</a>",
        "<a href=\"https://bsky.app/saved\">Saved</a>",
        "<a href=\"https://bsky.app/profile/freshtechbro.bsky.social\">Profile</a>",
        "<a href=\"https://bsky.app/settings\">Settings</a>",
        "</main>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/bluesky"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.details).toMatchObject({
        providerShell: "social_render_shell",
        constraint: {
          kind: "render_required",
          evidenceCode: "social_render_shell"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves extension-first fallback metadata when Bluesky recovery completes but still returns a javascript shell", async () => {
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      url?: string;
      runtimePolicy?: { browser?: { preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: request.runtimePolicy?.browser?.preferredModes?.[0] === "extension"
        ? "extension" as const
        : "managed_headed" as const,
      output: {
        url: request.url ?? "https://bsky.app/search?q=browser%20automation&page=1",
        html: "<html><head><title>Bluesky</title></head><body>Bluesky JavaScript Required</body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Bluesky</title></head><body>Bluesky JavaScript Required</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/bluesky"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.details).toMatchObject({
        browserFallbackMode: "extension",
        browserFallbackReasonCode: "env_limited",
        providerShell: "social_js_required_shell"
      });
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/bluesky",
        runtimePolicy: expect.objectContaining({
          browser: expect.objectContaining({
            preferredModes: ["extension", "managed_headed"]
          })
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies Reddit verification walls before search rows are returned and can still recover via fallback", async () => {
    const fallbackResolve = vi.fn(async (request: {
      reasonCode: string;
      url?: string;
      runtimePolicy?: { browser?: { preferredModes?: string[] } };
    }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: request.runtimePolicy?.browser?.preferredModes?.[0] === "extension"
        ? "extension" as const
        : "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.reddit.com/search/?q=browser%20automation&page=1",
        html: "<html><body><main><article><a href=\"https://www.reddit.com/r/browserautomation/comments/abc123/runtime_fix/\">Reddit fallback content</a></article></main></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Reddit</title></head><body>Please wait for verification.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/reddit"] }
      );

      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "social/reddit",
        reasonCode: "challenge_detected",
        url: "https://www.reddit.com/search?page=1&q=browser+automation&sort=relevance&t=all",
        runtimePolicy: expect.objectContaining({
          browser: expect.objectContaining({
            preferredModes: ["extension", "managed_headed"]
          })
        })
      }));
      expect(result.records[0]?.url).toBe("https://www.reddit.com/r/browserautomation/comments/abc123/runtime_fix");
      expect(result.records[0]?.attributes).toMatchObject({
        retrievalPath: "social:search:index",
        links: ["https://www.reddit.com/r/browserautomation/comments/abc123/runtime_fix"],
        browser_fallback_mode: "extension",
        browser_fallback_reason_code: "challenge_detected"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies Reddit help destinations as render-required env-limited failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://support.reddithelp.com/hc/en-us/articles/verification",
      text: async () => "<html><head><title>Reddit Help</title></head><body>Verification help</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/reddit"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error).toMatchObject({
        reasonCode: "env_limited",
        details: {
          providerShell: "social_first_party_help_shell",
          constraint: {
            kind: "render_required",
            evidenceCode: "social_first_party_help_shell"
          }
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies Facebook watch search shells as render-required env-limited failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.facebook.com/watch/search/?q=browser%20automation&page=1",
      text: async () => "<html><head><title>browser automation videos</title></head><body>Explore the latest browser automation videos in Video.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/facebook"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toMatchObject({
        reasonCode: "env_limited",
        details: {
          providerShell: "social_render_shell",
          constraint: {
            kind: "render_required",
            evidenceCode: "social_render_shell"
          }
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies direct Reddit non-content routes as render-required env-limited failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.reddit.com/submit",
      text: async () => "<html><head><title>Submit to Reddit</title></head><body>Submit to Reddit</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 5, filters: { pageLimit: 1 } },
        { source: "social", providerIds: ["social/reddit"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error).toMatchObject({
        reasonCode: "env_limited",
        details: {
          providerShell: "social_render_shell",
          constraint: {
            kind: "render_required",
            evidenceCode: "social_render_shell"
          }
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not attempt browser recovery for instagram auth-wall pages that are already explicit session boundaries", async () => {
    const fallbackResolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "token_required" as const,
      mode: "managed_headed" as const,
      output: {
        url: "https://www.instagram.com/explore/search/keyword/?q=browser%20automation&page=1",
        html: "<html><body>fallback social content</body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Login • Instagram</title></head><body>Log in to see photos and videos from friends.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime({}, {
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      });
      const result = await runtime.search(
        { query: "browser automation", limit: 5 },
        { source: "social", providerIds: ["social/instagram"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toMatchObject({
        code: "auth",
        reasonCode: "token_required",
        details: {
          blockerType: "auth_required",
          constraint: {
            kind: "session_required",
            evidenceCode: "auth_required"
          }
        }
      });
      expect(fallbackResolve).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies 200 anti-bot social search pages before traversal rows are returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Security verification</title></head><body>Verify you're human to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "browser automation", limit: 3 },
        { source: "social", providerIds: ["social/linkedin"] }
      );

      expect(result.ok).toBe(false);
      expect(result.records).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toMatchObject({
        code: "unavailable",
        reasonCode: "challenge_detected",
        details: {
          blockerType: "anti_bot_challenge"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exposes normalized capability metadata for all configured platforms", () => {
    expect(providers).toHaveLength(9);

    for (const provider of providers) {
      const caps = provider.capabilities();
      expect(caps.source).toBe("social");
      expect(caps.providerId).toBe(provider.id);
      expect(caps.policy.posting).toBe("gated");
      expect(caps.operations.search.supported).toBe(true);
      expect(caps.operations.fetch.supported).toBe(true);
      expect(caps.operations.post.supported).toBe(true);
      expect(caps.operations.crawl.supported).toBe(false);
      expect(typeof caps.metadata.platform).toBe("string");
      expect(typeof caps.metadata.maxPostLength).toBe("number");
      expect(typeof caps.metadata.supportsMedia).toBe("boolean");
      expect(typeof caps.metadata.supportsThreads).toBe("boolean");
    }
  });

  it("returns structured unavailable errors for unconfigured default retrieval/post paths", async () => {
    for (const provider of providers) {
      await expect(provider.search?.({ query: "release" }, context(`s-${provider.id}`)))
        .rejects.toMatchObject({ code: "unavailable" });
      await expect(provider.fetch?.({ url: "https://example.com/post/1" }, context(`f-${provider.id}`)))
        .rejects.toMatchObject({ code: "unavailable" });
      await expect(provider.post?.({
        target: "handle",
        content: "hello",
        confirm: true,
        riskAccepted: true
      }, context(`p-${provider.id}`))).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  it("applies bounded pagination/thread expansion with deterministic dedupe", async () => {
    const provider = createSocialProvider("threads", {
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 2,
        expansionPerRecord: 2,
        maxRecords: 8
      },
      search: async (input) => {
        const page = Number(input.filters?.page ?? 1);
        if (page === 1) {
          return [{
            url: "https://threads.net/@acct/post/1",
            title: "root",
            attributes: {
              links: ["https://threads.net/@acct/post/2"]
            }
          }];
        }
        return [{
          url: "https://threads.net/@acct/post/3",
          title: "page-two"
        }];
      },
      fetch: async (input) => {
        if (input.url.endsWith("/post/2")) {
          return {
            title: "expanded-2",
            content: "details-2",
            attributes: {
              links: ["https://threads.net/@acct/post/4"]
            }
          };
        }
        if (input.url.endsWith("/post/4")) {
          return {
            title: "expanded-4",
            content: "details-4"
          };
        }
        return {
          title: "fallback",
          content: "fallback"
        };
      }
    });

    const result = await provider.search?.({ query: "release", limit: 8 }, context("threads-traverse"));
    expect(result?.map((record) => record.url)).toEqual([
      "https://threads.net/@acct/post/1",
      "https://threads.net/@acct/post/3",
      "https://threads.net/@acct/post/2",
      "https://threads.net/@acct/post/4"
    ]);
    expect(result?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);
  });

  it("sorts duplicate canonical rows by title and skips queued links beyond hop limits", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("fetch should not run when hopLimit=0");
    });
    const provider = createSocialProvider("threads", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 0,
        expansionPerRecord: 2,
        maxRecords: 4
      },
      search: async () => ([
        {
          url: "https://threads.net/@acct/post/1",
          title: "z-last",
          attributes: {
            links: ["https://threads.net/@acct/post/2"]
          }
        },
        {
          url: "https://threads.net/@acct/post/1"
        }
      ]),
      fetch
    });

    const result = await provider.search?.({ query: "release", limit: 4 }, context("threads-dedupe-hop-limit"));

    expect(result).toHaveLength(1);
    expect(result?.[0]?.title).toBeUndefined();
    expect(result?.[0]?.attributes.platform).toBe("threads");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops thread expansion cleanly when no fetch implementation is configured", async () => {
    const provider = createSocialProvider("threads", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 2,
        expansionPerRecord: 2,
        maxRecords: 4
      },
      search: async () => ([
        {
          url: "https://threads.net/@acct/post/1",
          title: "root",
          attributes: {
            links: ["https://threads.net/@acct/post/2"]
          }
        }
      ])
    });

    const result = await provider.search?.({ query: "release", limit: 4 }, context("threads-no-fetch"));

    expect(result).toHaveLength(1);
    expect(result?.[0]?.url).toBe("https://threads.net/@acct/post/1");
  });

  it("rethrows unexpected expansion errors instead of silently skipping them", async () => {
    const provider = createSocialProvider("threads", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 2,
        expansionPerRecord: 1,
        maxRecords: 4
      },
      search: async () => [{
        url: "https://threads.net/@acct/post/1",
        title: "root",
        attributes: {
          links: ["https://threads.net/@acct/post/2"]
        }
      }],
      fetch: async () => {
        throw new Error("unexpected expansion failure");
      }
    });

    await expect(provider.search?.({ query: "release", limit: 4 }, context("threads-expansion-error")))
      .rejects.toThrow("unexpected expansion failure");
  });

  it("sorts duplicate rows with missing titles and skips queued links beyond the hop limit", async () => {
    const fetchSpy = vi.fn(async () => ({
      title: "expanded",
      content: "expanded",
      attributes: {
        links: ["https://threads.net/@acct/post/4"]
      }
    }));
    const provider = createSocialProvider("threads", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 1,
        maxRecords: 3
      },
      search: async () => [
        {
          url: "https://threads.net/@acct/post/1",
          title: "Zulu"
        },
        {
          url: "https://threads.net/@acct/post/1"
        },
        {
          url: "https://threads.net/@acct/post/2",
          title: "Alpha",
          attributes: {
            links: ["https://threads.net/@acct/post/3"]
          }
        }
      ],
      fetch: fetchSpy
    });

    const result = await provider.search?.({ query: "release", limit: 3 }, context("threads-hop-limit"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result?.map((record) => record.url)).toEqual([
      "https://threads.net/@acct/post/1",
      "https://threads.net/@acct/post/2",
      "https://threads.net/@acct/post/3"
    ]);
    expect(result?.[0]?.attributes.platform).toBe("threads");
    expect(result?.[0]?.attributes.traversal).toMatchObject({
      page: 1,
      hop: 0
    });
  });

  it("keeps duplicate canonical rows sortable when only the right-side title is missing", async () => {
    const provider = createSocialProvider("threads", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 1,
        maxRecords: 2
      },
      search: async () => [
        {
          url: "https://threads.net/@acct/post/1"
        },
        {
          url: "https://threads.net/@acct/post/1",
          title: "Zulu"
        }
      ]
    });

    const result = await provider.search?.({ query: "release", limit: 2 }, context("threads-right-title-fallback"));

    expect(result).toHaveLength(1);
    expect(result?.[0]?.url).toBe("https://threads.net/@acct/post/1");
    expect(result?.[0]?.title).toBeUndefined();
  });

  it("skips non-document social expansion links and tolerates recoverable expansion failures", async () => {
    const expansionFetches: string[] = [];
    const provider = createSocialProvider("x", {
      search: async () => [{
        url: "https://x.com/acct/root",
        title: "root",
        attributes: {
          links: [
            "https://abs.twimg.com/responsive-web/client-web/main.js",
            "https://x.com/acct/two",
            "https://x.com/acct/three"
          ]
        }
      }],
      fetch: async (input) => {
        expansionFetches.push(input.url);
        if (input.url.endsWith("/two")) {
          throw new ProviderRuntimeError("unavailable", `Retrieval failed for ${input.url}`, {
            provider: "social/x",
            source: "social",
            retryable: true
          });
        }
        return {
          url: input.url,
          title: "expanded",
          content: "expanded content"
        };
      }
    });

    const records = await provider.search?.({
      query: "openai",
      limit: 5,
      filters: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 5
      }
    }, context("social-expansion-skip"));

    expect(expansionFetches).toHaveLength(2);
    expect(expansionFetches).toEqual(expect.arrayContaining([
      "https://x.com/acct/two",
      "https://x.com/acct/three"
    ]));
    expect(records?.map((record) => record.url)).toEqual([
      "https://x.com/acct/root",
      "https://x.com/acct/three"
    ]);
  });

  it("propagates non-recoverable social expansion failures", async () => {
    const provider = createSocialProvider("x", {
      search: async () => [{
        url: "https://x.com/acct/root",
        title: "root",
        attributes: {
          links: ["https://x.com/acct/two"]
        }
      }],
      fetch: async (input) => {
        if (input.url.endsWith("/two")) {
          throw new ProviderRuntimeError("invalid_input", `Invalid expansion for ${input.url}`, {
            provider: "social/x",
            source: "social",
            retryable: false
          });
        }
        return {
          url: input.url,
          title: "ok",
          content: "ok"
        };
      }
    });

    await expect(provider.search?.({
      query: "openai",
      filters: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 1
      }
    }, context("social-expansion-fail"))).rejects.toMatchObject({
      code: "invalid_input"
    });
  });

  it("maps platform names through createSocialProvider switch", () => {
    for (const platform of platforms) {
      const provider = createSocialProvider(platform);
      expect(provider.id).toBe(`social/${platform}`);
      expect(provider.capabilities().metadata.platform).toBe(platform);
    }
  });

  it("applies option mapping in createSocialProviders", () => {
    const mapped = createSocialProviders({
      x: { id: "social/custom-x" },
      reddit: { id: "social/custom-reddit" },
      tiktok: { id: "social/custom-tiktok" }
    });

    const ids = mapped.map((provider) => provider.id);
    expect(ids).toContain("social/custom-x");
    expect(ids).toContain("social/custom-reddit");
    expect(ids).toContain("social/custom-tiktok");
  });

  it("rejects over-length posts according to adapter metadata", async () => {
    const xProvider = createSocialProvider("x");
    const max = Number(xProvider.capabilities().metadata.maxPostLength);

    await expect(xProvider.post?.({
      target: "me",
      content: "x".repeat(max + 1),
      confirm: true,
      riskAccepted: true
    }, context("over-limit"))).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("coerces traversal filters, skips invalid urls, and expands bounded links", async () => {
    const provider = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 2,
        expansionPerRecord: 3,
        maxRecords: 6
      },
      search: async () => ([
        {
          url: "notaurl",
          title: "skip"
        },
        {
          url: "https://x.com/acct/same",
          title: "z-title",
          attributes: {
            links: ["https://x.com/acct/one", 3],
            relatedUrls: ["https://x.com/acct/two"]
          }
        },
        {
          url: "https://x.com/acct/same",
          title: "a-title",
          attributes: {
            links: ["https://x.com/acct/one"],
            relatedUrls: ["https://x.com/acct/two"]
          }
        }
      ]),
      fetch: async (input) => ({
        url: input.url,
        title: "expanded",
        content: "expanded"
      })
    });

    const records = await provider.search?.({
      query: "macro",
      limit: 4,
      filters: {
        pageLimit: "1",
        hopLimit: "1",
        expansionPerRecord: "2",
        maxRecords: "20"
      }
    }, context("social-coerce"));

    expect(records?.map((record) => record.url)).toEqual([
      "https://x.com/acct/same",
      "https://x.com/acct/one",
      "https://x.com/acct/two"
    ]);
    expect(records?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);
  });

  it("returns unavailable when post policy passes but transport is missing", async () => {
    const provider = createSocialProvider("reddit", {
      postPolicyHooks: [async () => ({ allow: true })]
    });

    await expect(provider.post?.({
      target: "example",
      content: "policy ok",
      confirm: true,
      riskAccepted: true
    }, context("post-unavailable"))).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "policy_blocked"
    });
  });

  it("covers malformed traversal filters, fallback attributes, and health branches", async () => {
    const provider = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 1,
        expansionPerRecord: 2,
        maxRecords: 5
      },
      search: async (input) => {
        const page = Number(input.filters?.page ?? 1);
        if (page === 1) {
          return [
            {
              url: "https://x.com/acct/root",
              title: "root",
              content: "self https://x.com/acct/root and child https://x.com/acct/child",
              attributes: {
                links: ["https://x.com/acct/dup", "mailto:nope@example.com"]
              }
            },
            {
              url: "https://x.com/acct/dup",
              title: "dup"
            }
          ];
        }
        return [
          {
            url: "https://x.com/acct/page-two",
            title: "two"
          }
        ];
      },
      fetch: async (input) => {
        if (input.url.endsWith("/child")) {
          return {
            url: "notaurl",
            title: "bad-child"
          };
        }
        return {
          url: input.url,
          title: "expanded",
          content: "https://x.com/acct/dup https://x.com/acct/new"
        };
      },
      post: async () => ({})
    });

    const searched = await provider.search?.({
      query: "coverage",
      filters: {
        pageLimit: "NaN",
        hopLimit: "1",
        expansionPerRecord: "2",
        maxRecords: 10
      }
    }, context("social-coverage"));

    expect(searched?.map((record) => record.url)).toEqual([
      "https://x.com/acct/dup",
      "https://x.com/acct/root",
      "https://x.com/acct/page-two"
    ]);
    expect(searched?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);

    const fetched = await provider.fetch?.({ url: "https://x.com/acct/fetch" }, context("social-fetch"));
    expect(typeof fetched?.[0]?.attributes.extractionQuality).toBe("object");

    const posted = await provider.post?.({
      target: "acct",
      content: "hello social",
      confirm: true,
      riskAccepted: true
    }, context("social-post"));
    expect(typeof posted?.[0]?.attributes.auditHash).toBe("string");

    const healthy = await provider.health?.({
      trace: { requestId: "social-health", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(healthy?.status).toBe("healthy");

    const degradedProvider = createSocialProvider("x");
    const degraded = await degradedProvider.health?.({
      trace: { requestId: "social-health-degraded", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(degraded).toMatchObject({
      status: "degraded",
      reason: "Retrieval not configured"
    });
  });

  it("covers social traversal tie-break, hop-limit skip, max-record break, and seen-link guard", async () => {
    const tieAndBreak = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 0,
        expansionPerRecord: 2,
        maxRecords: 5
      },
      search: async () => ([
        { url: "https://x.com/acct/same", title: "z-title", content: "z" },
        { url: "https://x.com/acct/same", title: "a-title", content: "a" },
        { url: "https://x.com/acct/first", title: "first", attributes: { links: ["https://x.com/acct/child"] } },
        { url: "https://x.com/acct/second", title: "second" }
      ]),
      fetch: async () => ({
        title: "should-not-run",
        content: "no-fetch"
      })
    });

    const maxRecordCut = await tieAndBreak.search?.({
      query: "tie",
      limit: 1
    }, context("social-tie-break"));
    expect(maxRecordCut?.map((record) => record.url)).toEqual(["https://x.com/acct/first"]);

    const hopSkipped = await tieAndBreak.search?.({
      query: "hop",
      filters: { hopLimit: 0, maxRecords: 4 }
    }, context("social-hop-skip"));
    expect(hopSkipped?.map((record) => record.url)).toContain("https://x.com/acct/first");

    const expandAndSeen = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 2,
        expansionPerRecord: 2,
        maxRecords: 4
      },
      search: async () => ([
        {
          url: "https://x.com/acct/root",
          title: "root",
          attributes: { links: ["https://x.com/acct/child"] }
        }
      ]),
      fetch: async (input) => ({
        url: input.url,
        title: "expanded",
        content: "expanded",
        attributes: {
          links: ["https://x.com/acct/root"]
        }
      })
    });

    const expanded = await expandAndSeen.search?.({ query: "expand" }, context("social-expand-seen"));
    expect(expanded?.map((record) => record.url)).toEqual([
      "https://x.com/acct/root",
      "https://x.com/acct/child"
    ]);
  });

  it("covers first-party search attribute carry-forward and recoverable pagination stops", async () => {
    const searchRouteProvider = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 1,
        maxRecords: 4
      },
      search: async () => ([
        {
          url: "https://x.com/search?q=no-attrs",
          content: "search shell",
          attributes: {
            links: ["https://x.com/acct/status/101"]
          }
        },
        {
          url: "https://x.com/search?q=ignored-attrs",
          content: "search shell",
          attributes: {
            ignored: true,
            links: ["https://x.com/acct/status/202"]
          }
        }
      ]),
      fetch: async (input) => ({
        url: input.url,
        title: "status",
        content: "status"
      })
    });

    const searchRouteRecords = await searchRouteProvider.search?.({
      query: "carry-forward"
    }, context("social-carry-forward"));
    expect(searchRouteRecords?.map((record) => record.url)).toEqual([
      "https://x.com/acct/status/202",
      "https://x.com/acct/status/101"
    ]);

    const paginationProvider = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 0,
        expansionPerRecord: 0,
        maxRecords: 4
      },
      search: async (input) => {
        if (input.filters?.page === 2) {
          throw new ProviderRuntimeError("timeout", "second page timed out", {
            provider: "social/x",
            source: "social"
          });
        }
        return [{
          url: "https://x.com/acct/status/303",
          title: "first page"
        }];
      }
    });

    const paginatedRecords = await paginationProvider.search?.({
      query: "recoverable page stop"
    }, context("social-page-stop"));
    expect(paginatedRecords?.map((record) => record.url)).toEqual([
      "https://x.com/acct/status/303"
    ]);
  });

  it("keeps recovered facebook search rows when browser metadata has visible content only", async () => {
    const provider = createSocialProvider("facebook", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 0,
        expansionPerRecord: 0,
        maxRecords: 2
      },
      search: async () => ([{
        url: "https://www.facebook.com/watch/search/?q=browser+automation",
        content: "Recovered browser-rendered search content",
        attributes: {
          browser_fallback_mode: "extension"
        }
      }])
    });

    const records = await provider.search?.({
      query: "facebook visible content"
    }, context("facebook-visible-content"));
    expect(records?.[0]).toMatchObject({
      url: "https://www.facebook.com/watch/search?q=browser+automation",
      content: "Recovered browser-rendered search content"
    });
  });

  it("filters first-party help and home links out of social traversal expansions", async () => {
    const fetch = vi.fn(async (input: { url: string }) => ({
      url: input.url,
      title: "expanded",
      content: "expanded"
    }));
    const provider = createSocialProvider("bluesky", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 4,
        maxRecords: 5
      },
      search: async () => ([{
        url: "https://bsky.app/search?q=browser+automation",
        title: "search",
        attributes: {
          links: [
            "https://atproto.com/guides/overview",
            "https://bsky.social/about",
            "https://bsky.app",
            "https://bsky.app/profile/acct/post/1"
          ]
        }
      }]),
      fetch
    });

    const result = await provider.search?.({ query: "browser automation", limit: 5 }, context("bluesky-traversal-filter"));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://bsky.app/profile/acct/post/1"
    }), expect.any(Object));
    expect(result?.map((record) => record.url)).toEqual(["https://bsky.app/profile/acct/post/1"]);
  });

  it("prioritizes usable Bluesky result links before expansion slicing", async () => {
    const fetch = vi.fn(async (input: { url: string }) => ({
      url: input.url,
      title: "expanded",
      content: "expanded"
    }));
    const provider = createSocialProvider("bluesky", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 1,
        maxRecords: 5
      },
      search: async () => ([{
        url: "https://bsky.app/search?q=browser+automation",
        title: "search",
        attributes: {
          links: [
            "https://docs.example.com/browser-automation-1",
            "https://docs.example.com/browser-automation-2",
            "https://docs.example.com/browser-automation-3",
            "https://bsky.app/profile/acct/post/9"
          ]
        }
      }]),
      fetch
    });

    const result = await provider.search?.({ query: "browser automation", limit: 5 }, context("bluesky-priority-slice"));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://bsky.app/profile/acct/post/9"
    }), expect.any(Object));
    expect(result?.map((record) => record.url)).toEqual(["https://bsky.app/profile/acct/post/9"]);
  });

  it("filters Reddit non-content and auth expansion links out of social traversal expansions", async () => {
    const fetch = vi.fn(async (input: { url: string }) => ({
      url: input.url,
      title: "expanded",
      content: "expanded"
    }));
    const provider = createSocialProvider("reddit", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 8,
        maxRecords: 6
      },
      search: async () => ([{
        url: "https://www.reddit.com/search/?q=browser+automation",
        title: "search",
        attributes: {
          links: [
            "https://accounts.google.com/gsi/style",
            "https://ads.reddit.com/register",
            "https://www.reddit.com/submit",
            "https://www.reddit.com/account/login",
            "https://www.reddit.com/ads/library",
            "https://www.reddit.com/notifications",
            "https://www.reddit.com/verification",
            "https://www.reddit.com/r/test/comments/abc123/thread/"
          ]
        }
      }]),
      fetch
    });

    const result = await provider.search?.({ query: "browser automation", limit: 6 }, context("reddit-traversal-filter"));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.reddit.com/r/test/comments/abc123/thread"
    }), expect.any(Object));
    expect(result?.map((record) => record.url)).toEqual(["https://www.reddit.com/r/test/comments/abc123/thread"]);
  });
});
