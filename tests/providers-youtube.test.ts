import { afterEach, describe, expect, it, vi } from "vitest";
import { createYouTubeProvider, withDefaultYouTubeOptions } from "../src/providers/social";
import { resolveProviderRuntimePolicy } from "../src/providers/runtime-policy";

const context = {
  trace: { requestId: "yt-test", ts: "2026-02-16T00:00:00.000Z" },
  timeoutMs: 1000,
  attempt: 1 as const
};

describe("youtube social adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays unavailable when no retrieval options are configured", async () => {
    const provider = createYouTubeProvider();

    await expect(provider.search?.({ query: "release notes" }, context))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.fetch?.({ url: "https://www.youtube.com/watch?v=abc" }, context))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("supports search/fetch with transcript enrichment when defaults are enabled", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=abc123";
    const searchHtml = '<html><body><main>search text</main>"videoId":"abc123def45"</body></html>';
    const watchHtml = `
      <html>
        <body>
          <main>video page body</main>
          <meta itemprop="author" content="Canal Uno" />
          <meta itemprop="datePublished" content="2026-02-01T10:00:00.000Z" />
          "viewCount":"12345"
          "captionTracks":[{"baseUrl":"${transcriptUrl.replace(/&/g, "\\u0026")}","languageCode":"es"}]
        </body>
      </html>
    `;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("results?search_query")) {
        return {
          status: 200,
          url,
          text: async () => searchHtml
        };
      }
      if (url.startsWith(transcriptUrl)) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => "<transcript><text>hola mundo</text><text>segunda linea</text></transcript>"
        };
      }
      return {
        status: 200,
        url,
        text: async () => watchHtml
      };
    }) as unknown as typeof fetch);

    const searched = await provider.search?.({ query: "new release" }, context);
    expect(searched?.[0]?.attributes.video_id).toBe("abc123def45");

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=abc123def45",
      filters: {
        requireTranscript: true,
        translateToEnglish: true,
        include_full_transcript: true
      }
    }, context);

    expect(fetched?.[0]?.attributes).toMatchObject({
      transcript_available: true,
      transcript_strategy_detail: "native_caption_parse",
      transcript_language: "es",
      translation_applied: true,
      video_id: "abc123def45",
      channel: "Canal Uno",
      published_at: "2026-02-01T10:00:00.000Z",
      views: 12345
    });
    expect((fetched?.[0]?.attributes.date_confidence as { source: string }).source).toBe("explicit");
    expect(String(fetched?.[0]?.attributes.transcript_full ?? "")).toContain("translated:es");
  });

  it("honors string transcript filter values without emitting full transcript output", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=stringflags1";
    const watchHtml = `
      <html>
        <body>
          <main>Spanish product walkthrough</main>
          "captionTracks":[{"baseUrl":"${transcriptUrl.replace(/&/g, "\\u0026")}","languageCode":"es"}]
        </body>
      </html>
    `;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(transcriptUrl)) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => "<transcript><text>hola mundo</text></transcript>"
        };
      }
      return {
        status: 200,
        url,
        text: async () => watchHtml
      };
    }) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=stringflags1",
      filters: {
        requireTranscript: "true",
        translateToEnglish: "false",
        include_full_transcript: "false"
      }
    }, context);

    expect(fetched?.[0]?.attributes).toMatchObject({
      transcript_available: true,
      transcript_language: "es",
      translation_applied: false
    });
    expect(fetched?.[0]?.attributes).not.toHaveProperty("transcript_full");
  });

  it("keeps direct URL search results on the requested watch page", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            <main>Requested watch page with related videos</main>
            <a href="/watch?v=otherid0000">Related video</a>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    const records = await provider.search?.({
      query: "https://www.youtube.com/watch?v=pageurl0001"
    }, context);

    expect(records?.[0]?.url).toBe("https://www.youtube.com/watch?v=pageurl0001");
    expect(records?.[0]?.attributes).toMatchObject({
      retrievalPath: "social:youtube:search:url",
      video_id: "pageurl0001"
    });
    expect(records?.[0]?.attributes.links).toContain("https://www.youtube.com/watch?v=otherid0000");
  });

  it("returns explicit unavailable errors when transcript is required but missing", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body><main>no captions</main></body></html>"
    })) as unknown as typeof fetch);

    await expect(provider.fetch?.({
      url: "https://www.youtube.com/watch?v=noTranscript",
      filters: {
        requireTranscript: true
      }
    }, context)).rejects.toMatchObject({
      code: "unavailable",
      details: {
        reasonCode: "transcript_unavailable"
      }
    });
  });

  it("passes extension-first recovery hints into browser-assisted transcript fallback", async () => {
    const fallbackResolve = vi.fn(async (request: { url?: string }) => ({
      ok: true as const,
      reasonCode: "transcript_unavailable" as const,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/watch?v=browserassist123",
        html: "<html><body><main>fallback transcript page</main></body></html>"
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      transcriptResolver: {
        modeDefault: "web",
        enableBrowserFallback: true
      },
      browserFallbackPort: {
        resolve: fallbackResolve
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body><main>no captions</main></body></html>"
    })) as unknown as typeof fetch);

    await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=browserassist123",
      filters: {
        requireTranscript: false
      }
    }, context);

    expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/youtube",
      url: "https://www.youtube.com/watch?v=browserassist123",
      runtimePolicy: expect.objectContaining({
        browser: {
          preferredModes: ["extension", "managed_headed"],
          forceTransport: false
        }
      })
    }));
  });

  it("uses the runtime context port for browser-assisted transcript fallback", async () => {
    const optionFallbackResolve = vi.fn();
    const contextFallbackResolve = vi.fn(async (request: { url?: string }) => ({
      ok: true as const,
      reasonCode: "transcript_unavailable" as const,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/watch?v=contextport01",
        html: "<html><body><main>runtime context transcript page</main></body></html>"
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      transcriptResolver: {
        modeDefault: "web",
        enableBrowserFallback: true
      },
      browserFallbackPort: { resolve: optionFallbackResolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body><main>no captions</main></body></html>"
    })) as unknown as typeof fetch);

    await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=contextport01",
      filters: {
        requireTranscript: false
      }
    }, {
      ...context,
      browserFallbackPort: { resolve: contextFallbackResolve }
    });

    expect(contextFallbackResolve).toHaveBeenCalledOnce();
    expect(optionFallbackResolve).not.toHaveBeenCalled();
  });

  it("uses browser transport for auth-blocked YouTube search pages", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/results?search_query=browser%20automation",
        html: `<html><body><script>{"videoId":"abc123def45","title":{"runs":[{"text":"Recovered YouTube result"}]}}</script></body></html>`
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: {
        resolve: fallbackResolve
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 403,
      url: String(input),
      text: async () => "auth blocked"
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation" }, context);

    expect(records?.[0]?.url).toBe("https://www.youtube.com/watch?v=abc123def45");
    expect(records?.[0]?.attributes).toMatchObject({
      browser_fallback_mode: "extension",
      browser_fallback_reason_code: "token_required",
      video_id: "abc123def45"
    });
    expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/youtube",
      reasonCode: "token_required"
    }));
  });

  it("uses browser transport for rate-limited YouTube search pages", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/results?search_query=browser%20automation",
        html: `<html><body><script>{"videoId":"rate123abcd","title":{"runs":[{"text":"Rate limited recovered result"}]}}</script></body></html>`
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: {
        resolve: fallbackResolve
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 429,
      url: String(input),
      text: async () => "rate limited"
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation" }, context);

    expect(records?.[0]?.url).toBe("https://www.youtube.com/watch?v=rate123abcd");
    expect(records?.[0]?.attributes).toMatchObject({
      browser_fallback_mode: "extension",
      browser_fallback_reason_code: "rate_limited",
      video_id: "rate123abcd"
    });
    expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/youtube",
      reasonCode: "rate_limited"
    }));
  });

  it("recovers thrown YouTube page fetches through browser transport evidence", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        html: `<html><body><script>{"videoId":"throw123456","title":{"runs":[{"text":"Thrown fetch recovered"}]}}</script></body></html>`
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve: fallbackResolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket closed");
    }) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser recovery" }, context);

    expect(records?.[0]?.url).toBe("https://www.youtube.com/watch?v=throw123456");
    expect(records?.[0]?.attributes).toMatchObject({
      browser_fallback_mode: "managed_headed",
      browser_fallback_reason_code: "env_limited"
    });
    expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "env_limited",
      details: expect.objectContaining({
        errorCode: "network",
        message: expect.stringContaining("Failed to retrieve")
      })
    }));
  });

  it("maps auth-blocked YouTube pages to auth_required when cookies are required", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/results?search_query=private",
        html: `<html><body><script>{"videoId":"authreq1234","title":{"runs":[{"text":"Auth recovered"}]}}</script></body></html>`
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve: fallbackResolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 403,
      url: String(input),
      text: async () => "sign in required"
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "private" }, {
      ...context,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: {
          browserMode: "extension",
          useCookies: true,
          cookiePolicyOverride: "required"
        }
      })
    });

    expect(records?.[0]?.attributes).toMatchObject({
      browser_fallback_reason_code: "auth_required",
      video_id: "authreq1234"
    });
    expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "auth_required"
    }));
  });

  it("rejects preserved YouTube challenge sessions as explicit provider failures", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string }) => ({
      ok: false as const,
      reasonCode: request.reasonCode,
      disposition: "challenge_preserved" as const,
      mode: "extension" as const,
      details: {
        message: "YouTube challenge still requires interaction."
      }
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve: fallbackResolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 429,
      url: String(input),
      text: async () => "rate limited"
    })) as unknown as typeof fetch);

    await expect(provider.search?.({ query: "browser challenge" }, context)).rejects.toMatchObject({
      reasonCode: "rate_limited",
      message: "YouTube challenge still requires interaction."
    });
  });

  it("accepts YouTube fallback pages with concrete video links even without JSON markers", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/results?search_query=links",
        html: `<html><body><main>Recovered results with enough useful text</main><a href="/watch?v=link1234567">video</a></body></html>`
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve: fallbackResolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 500,
      url: String(input),
      text: async () => "server blocked"
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "links" }, context);

    expect(records?.[0]?.url).toBe("https://www.youtube.com/watch?v=link1234567");
    expect(records?.[0]?.attributes.browser_fallback_mode).toBe("extension");
  });

  it("uses direct extension transport for YouTube fetch pages when browser mode is forced", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=direct00000",
      text: async () => "<html><body>direct fetch should not run</body></html>"
    })) as unknown as typeof fetch;
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/watch?v=abc123def45",
        html: "<html><body><main>signed in watch page body with no public captions</main></body></html>"
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: {
        resolve: fallbackResolve
      }
    }));

    vi.stubGlobal("fetch", fetchMock);

    const records = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=abc123def45",
      filters: { requireTranscript: false }
    }, {
      ...context,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: {
          browserMode: "extension",
          useCookies: true,
          cookiePolicyOverride: "required"
        }
      })
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(records?.[0]?.attributes).toMatchObject({
      browser_fallback_mode: "extension",
      browser_fallback_reason_code: "auth_required",
      retrievalPath: "social:youtube:fetch:url"
    });
    expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/youtube",
      reasonCode: "auth_required"
    }));
  });

  it("rejects completed YouTube fallback output without html after server-blocked fetch", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/watch?v=serverblk01"
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: {
        resolve: fallbackResolve
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 500,
      url: String(input),
      text: async () => "server blocked"
    })) as unknown as typeof fetch);

    await expect(provider.fetch?.({
      url: "https://www.youtube.com/watch?v=serverblk01",
      filters: { requireTranscript: false }
    }, context)).rejects.toMatchObject({
      code: "upstream",
      reasonCode: "ip_blocked",
      details: expect.objectContaining({
        browserFallbackMode: "extension",
        fallbackOutputReason: "missing_or_empty_html"
      })
    });
    expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/youtube",
      reasonCode: "ip_blocked"
    }));
  });

  it("rejects completed YouTube fallback output that is still an anti-bot sign-in wall", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/watch?v=loginwall01",
        html: "<html><body><main>Sign in to confirm you are not a bot</main></body></html>"
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve: fallbackResolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 500,
      url: String(input),
      text: async () => "server blocked"
    })) as unknown as typeof fetch);

    await expect(provider.fetch?.({
      url: "https://www.youtube.com/watch?v=loginwall01",
      filters: { requireTranscript: false }
    }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "challenge_detected",
      details: expect.objectContaining({
        fallbackOutputReason: "anti_bot_challenge"
      })
    });
  });

  it("rejects completed YouTube fallback output that is only site chrome", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true as const,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.youtube.com/results?search_query=automation",
        html: "<html><body>About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy</body></html>"
      },
      details: {}
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve: fallbackResolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 429,
      url: String(input),
      text: async () => "rate limited"
    })) as unknown as typeof fetch);

    await expect(provider.search?.({ query: "automation" }, context)).rejects.toMatchObject({
      code: "rate_limited",
      reasonCode: "rate_limited",
      details: expect.objectContaining({
        fallbackOutputReason: "youtube_shell_or_metadata"
      })
    });
  });
});
