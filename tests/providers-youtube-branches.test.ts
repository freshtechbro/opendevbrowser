import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYouTubeProvider,
  withDefaultYouTubeOptions,
  validateYouTubeLegalReviewChecklist,
  YOUTUBE_LEGAL_REVIEW_CHECKLIST
} from "../src/providers/social";
import { ProviderRuntimeError } from "../src/providers/errors";
import { resolveProviderRuntimePolicy } from "../src/providers/runtime-policy";

const context = {
  trace: { requestId: "yt-branches", ts: new Date().toISOString() },
  timeoutMs: 1000,
  attempt: 1 as const
};

describe("youtube provider branches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("blocks youtube requests when legal review approval is expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));

    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    await expect(provider.search?.({ query: "release notes" }, context)).rejects.toMatchObject({
      code: "policy_blocked",
      details: {
        reasonCode: "approval_expired"
      }
    });
  });

  it("returns granular youtube legal-review reason codes", () => {
    const original = { ...YOUTUBE_LEGAL_REVIEW_CHECKLIST };
    const cases: Array<{
      expected: string;
      patch: Partial<typeof YOUTUBE_LEGAL_REVIEW_CHECKLIST>;
      now?: Date;
    }> = [
      { expected: "missing_terms_review_date", patch: { termsReviewDate: "   " } },
      { expected: "invalid_terms_review_date", patch: { termsReviewDate: "bad-date" } },
      { expected: "missing_allowed_surfaces", patch: { allowedExtractionSurfaces: ["   "] } },
      { expected: "missing_prohibited_flows", patch: { prohibitedFlows: ["   "] } },
      { expected: "missing_reviewer", patch: { reviewer: "   " } },
      { expected: "missing_approval_expiry", patch: { approvalExpiryDate: "   " } },
      { expected: "missing_approved_transcript_strategies", patch: { approvedTranscriptStrategies: ["   "] as unknown as string[] } },
      { expected: "invalid_approval_expiry", patch: { approvalExpiryDate: "not-a-date" } },
      { expected: "approval_expired", patch: { approvalExpiryDate: "2026-02-15T23:59:59.000Z" }, now: new Date("2026-02-16T00:00:00.000Z") },
      { expected: "not_signed_off", patch: { signedOff: false } }
    ];

    try {
      cases.forEach(({ expected, patch, now }) => {
        Object.assign(YOUTUBE_LEGAL_REVIEW_CHECKLIST, original, patch);
        const result = validateYouTubeLegalReviewChecklist(now ?? new Date("2026-02-16T00:00:00.000Z"));
        expect(result).toMatchObject({
          valid: false,
          reasonCode: expected
        });
      });
    } finally {
      Object.assign(YOUTUBE_LEGAL_REVIEW_CHECKLIST, original);
    }
  });

  it("rejects empty search query when defaults are enabled", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    await expect(provider.search?.({ query: "   " }, context)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects empty query in the raw default youtube search handler", async () => {
    const options = withDefaultYouTubeOptions();
    expect(options.recoveryHints?.()).toMatchObject({
      preferredFallbackModes: ["extension", "managed_headed"],
      challengeProne: true,
      settleTimeoutMs: 5000,
      captureDelayMs: 500
    });
    expect(options.defaultTraversal).toMatchObject({
      pageLimit: 1,
      hopLimit: 0,
      expansionPerRecord: 1,
      maxRecords: 8
    });
    await expect(options.search?.({ query: "   " }, context)).rejects.toMatchObject({
      code: "invalid_input"
    });
  });

  it("uses direct URL search path when query is already a URL", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    const directUrl = "https://www.youtube.com/results?search_query=manual";

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body><main>manual search result body</main></body></html>"
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: directUrl }, context);
    expect(records?.[0]?.url).toBe(directUrl);
    expect(records?.[0]?.attributes).toMatchObject({
      retrievalPath: "social:youtube:search:url",
      video_id: null
    });
  });

  it("rejects generic YouTube search chrome as an env-limited shell", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    await expect(provider.search?.({ query: "browser automation youtube" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: expect.objectContaining({
        providerShell: "youtube_search_shell",
        browserRequired: true
      })
    });
  });

  it("uses completed browser transport when YouTube force transport is requested", async () => {
    const resolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "env_limited" as const,
      disposition: "completed" as const,
      output: {
        url: "https://www.youtube.com/results?search_query=forced",
        html: "<html><body><script>{\"videoId\":\"StC_uaWoiOs\"}</script><main>browser fallback content with enough text</main></body></html>"
      }
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve }
    }));

    const records = await provider.search?.({ query: "forced browser youtube" }, {
      ...context,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: { browserMode: "extension" }
      })
    });

    expect(records?.[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=StC_uaWoiOs",
      attributes: {
        retrievalPath: "social:youtube:search:index",
        video_id: "StC_uaWoiOs",
        browser_fallback_reason_code: "env_limited"
      }
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "social/youtube",
      operation: "search",
      reasonCode: "env_limited"
    }));
  });

  it("fails forced YouTube browser transport when no browser port is available", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    await expect(provider.search?.({ query: "forced without port" }, {
      ...context,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: { browserMode: "extension" }
      })
    })).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        browserTransportRequired: true
      }
    });
  });

  it("maps upstream YouTube body failures into browser fallback recovery", async () => {
    const resolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "ip_blocked" as const,
      disposition: "completed" as const,
      output: {
        url: "https://www.youtube.com/results?search_query=upstream",
        html: "<html><body><a href=\"https://www.youtube.com/watch?v=StC_uaWoiOs\">Recovered upstream video</a></body></html>"
      }
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => {
        throw new ProviderRuntimeError("upstream", "upstream body failed", {
          provider: "social/youtube",
          source: "social",
          retryable: true
        });
      }
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "upstream failed youtube" }, context);

    expect(records?.[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=StC_uaWoiOs",
      attributes: {
        video_id: "StC_uaWoiOs",
        browser_fallback_reason_code: "ip_blocked"
      }
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "ip_blocked",
      details: expect.objectContaining({
        errorCode: "upstream",
        message: "upstream body failed"
      })
    }));
  });

  it("recovers YouTube search through fallback when the direct body stream fails", async () => {
    const resolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "env_limited" as const,
      disposition: "completed" as const,
      output: {
        url: "https://www.youtube.com/results?search_query=body-failed",
        html: "<html><body><a href=\"https://www.youtube.com/watch?v=StC_uaWoiOs\">Recovered video</a></body></html>"
      }
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => {
        throw new Error("body stream failed");
      }
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "body failed youtube" }, context);

    expect(records?.[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=StC_uaWoiOs",
      attributes: {
        video_id: "StC_uaWoiOs",
        browser_fallback_reason_code: "env_limited"
      }
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "env_limited",
      details: {}
    }));
  });

  it("requests auth-required fallback for YouTube auth failures when cookies are required", async () => {
    const resolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "auth_required" as const,
      disposition: "failed" as const,
      details: {
        message: "Authenticated browser session required."
      }
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 401,
      url: String(input),
      text: async () => "auth wall"
    })) as unknown as typeof fetch);

    await expect(provider.fetch?.({ url: "https://www.youtube.com/watch?v=authneeded1" }, {
      ...context,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: { cookiePolicyOverride: "required" }
      })
    })).rejects.toMatchObject({
      code: "auth",
      reasonCode: "auth_required"
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      operation: "fetch",
      reasonCode: "auth_required"
    }));
  });

  it.each([
    {
      label: "empty html",
      html: "",
      outputReason: "missing_or_empty_html",
      reasonCode: "env_limited"
    },
    {
      label: "site chrome shell",
      html: "<html><body>About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy and Google for developers skip to main content YouTube</body></html>",
      outputReason: "youtube_shell_or_metadata",
      reasonCode: "env_limited"
    },
    {
      label: "challenge shell",
      html: "<html><body>Security check required. Please complete the captcha challenge to continue watching this video.</body></html>",
      outputReason: "anti_bot_challenge",
      reasonCode: "challenge_detected"
    }
  ])("rejects completed YouTube fallback output when it is $label", async ({ html, outputReason, reasonCode }) => {
    const resolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "env_limited" as const,
      disposition: "completed" as const,
      output: {
        url: "https://www.youtube.com/results?search_query=blocked",
        html
      }
    }));
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      browserFallbackPort: { resolve }
    }));

    await expect(provider.search?.({ query: "blocked youtube" }, {
      ...context,
      runtimePolicy: resolveProviderRuntimePolicy({
        source: "social",
        runtimePolicy: { browserMode: "extension" }
      })
    })).rejects.toMatchObject({
      code: "unavailable",
      reasonCode,
      details: expect.objectContaining({
        fallbackOutputReason: outputReason
      })
    });
  });

  it("extracts the first real search result without carrying generic site chrome into the record", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            <script>
              var ytInitialData = {
                "contents": {
                  "twoColumnSearchResultsRenderer": {
                    "primaryContents": {
                      "sectionListRenderer": {
                        "contents": [{
                          "itemSectionRenderer": {
                            "contents": [{
                              "videoRenderer": {
                                "videoId": "StC_uaWoiOs",
                                "title": { "runs": [{ "text": "This is how I automated a YouTube Channel (n8n + No-code)" }] },
                                "longBylineText": { "runs": [{ "text": "Builders Central" }] },
                                "publishedTimeText": { "simpleText": "4 months ago" },
                                "viewCountText": { "simpleText": "98,017 views" },
                                "detailedMetadataSnippets": [{
                                  "snippetText": {
                                    "runs": [
                                      { "text": "In this video, we explained how to build an automated content workflow." }
                                    ]
                                  }
                                }]
                              }
                            }]
                          }
                        }]
                      }
                    }
                  }
                }
              };
            </script>
            <footer>
              About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy
            </footer>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation youtube" }, context);

    expect(records?.[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=StC_uaWoiOs",
      title: "This is how I automated a YouTube Channel (n8n + No-code)"
    });
    expect(records?.[0]?.content).toContain("Builders Central");
    expect(records?.[0]?.content).toContain("98,017 views");
    expect(records?.[0]?.content).not.toMatch(/About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy/i);
    expect(records?.[0]?.attributes).toMatchObject({
      retrievalPath: "social:youtube:search:index",
      video_id: "StC_uaWoiOs",
      channel: "Builders Central",
      links: []
    });
  });

  it("limits primary YouTube search metadata to the first video renderer segment", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => [
        "<html><body><script>",
        "{\"videoRenderer\":{\"videoId\":\"StC_uaWoiOs\",",
        "\"title\":{\"runs\":[{\"text\":\"First automation result\"}]},",
        "\"shortBylineText\":{\"runs\":[{\"text\":\"First Channel\"}]},",
        "\"detailedMetadataSnippets\":[{\"snippetText\":{\"runs\":[{\"text\":\"First snippet only\"}]}}]",
        "}},",
        "\"videoRenderer\":{\"videoId\":\"dQw4w9WgXcQ\",",
        "\"title\":{\"runs\":[{\"text\":\"Second result should be ignored\"}]}}}",
        "</script></body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "segmented youtube" }, context);

    expect(records?.[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=StC_uaWoiOs",
      title: "First automation result",
      content: expect.stringContaining("First snippet only")
    });
    expect(records?.[0]?.content).not.toContain("Second result should be ignored");
    expect(records?.[0]?.attributes).toMatchObject({
      channel: "First Channel",
      video_id: "StC_uaWoiOs"
    });
  });

  it("keeps a recovered watch link when search HTML only exposes footer chrome around the result page", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            <a href="/watch?v=StC_uaWoiOs">Watch</a>
            <footer>
              About Press Copyright Contact us Creators Advertise Developers Terms Privacy Policy
            </footer>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation youtube" }, context);

    expect(records?.[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=StC_uaWoiOs",
      title: "YouTube search: browser automation youtube"
    });
    expect(records?.[0]?.content ?? "").toBe("");
    expect(records?.[0]?.attributes).toMatchObject({
      retrievalPath: "social:youtube:search:index",
      video_id: "StC_uaWoiOs",
      links: ["https://www.youtube.com/watch?v=StC_uaWoiOs"]
    });
  });

  it("normalizes alternate youtube hosts while ignoring foreign watch links", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            <a href="https://example.com/watch?v=ignored11111">Foreign host</a>
            <a href="https://youtu.be/StC_uaWoiOs">Short link</a>
            <a href="https://music.youtube.com/watch?v=StC_uaWoiOs&feature=share">Music</a>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation youtube" }, context);

    expect(records?.[0]?.url).toBe("https://www.youtube.com/watch?v=StC_uaWoiOs");
    expect(records?.[0]?.attributes).toMatchObject({
      video_id: "StC_uaWoiOs",
      links: ["https://www.youtube.com/watch?v=StC_uaWoiOs"]
    });
  });

  it("keeps the search result page when extracted youtube links do not resolve to a video id", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            <a href="https://www.youtube.com/channel/UC12345678901">Channel</a>
            <a href="https://www.youtube.com/@automationlab">Handle</a>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation youtube" }, context);

    expect(records?.[0]?.url).toBe("https://www.youtube.com/results?search_query=browser+automation+youtube");
    expect(records?.[0]?.attributes).toMatchObject({
      video_id: null,
      links: []
    });
  });

  it("keeps channel and views metadata even when the primary result omits title and snippet text", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            <script>
              var ytInitialData = {
                "contents": {
                  "twoColumnSearchResultsRenderer": {
                    "primaryContents": {
                      "sectionListRenderer": {
                        "contents": [{
                          "itemSectionRenderer": {
                            "contents": [{
                              "videoRenderer": {
                                "videoId": "StC_uaWoiOs",
                                "ownerText": { "runs": [{ "text": "Automation Lab" }] },
                                "viewCountText": { "simpleText": "12,345 views" }
                              }
                            }]
                          }
                        }]
                      }
                    }
                  }
                }
              };
            </script>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation youtube" }, context);

    expect(records?.[0]?.title).toBe("YouTube search: browser automation youtube");
    expect(records?.[0]?.content).toContain("Channel: Automation Lab.");
    expect(records?.[0]?.content).toContain("Views: 12,345 views.");
    expect(records?.[0]?.attributes).toMatchObject({
      video_id: "StC_uaWoiOs",
      channel: "Automation Lab"
    });
  });

  it("keeps a title-only primary result without fabricating channel metadata", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <body>
            <script>
              var ytInitialData = {
                "contents": {
                  "twoColumnSearchResultsRenderer": {
                    "primaryContents": {
                      "sectionListRenderer": {
                        "contents": [{
                          "itemSectionRenderer": {
                            "contents": [{
                              "videoRenderer": {
                                "videoId": "StC_uaWoiOs",
                                "title": { "runs": [{ "text": "Automation without extra metadata" }] }
                              }
                            }]
                          }
                        }]
                      }
                    }
                  }
                }
              };
            </script>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);

    const records = await provider.search?.({ query: "browser automation youtube" }, context);

    expect(records?.[0]?.title).toBe("Automation without extra metadata");
    expect(records?.[0]?.content ?? "").toBe("");
    expect(records?.[0]?.attributes).toMatchObject({
      video_id: "StC_uaWoiOs"
    });
    expect(records?.[0]?.attributes).not.toHaveProperty("channel");
  });

  it("summarizes long english transcripts without translation when full transcript is disabled", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    const videoUrl = "https://youtu.be/abc123def45";
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=abc123def45";

    const longTranscript = Array.from({ length: 80 }, (_, index) => `<text>line ${index} with enough words to build a long transcript payload</text>`).join("");
    const pageHtml = `<html><body><main>video body</main>\n"captionTracks":[{"baseUrl":"${transcriptUrl.replace(/&/g, "\\u0026")}","languageCode":"en"}]</body></html>`;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(transcriptUrl)) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => `<transcript>${longTranscript}</transcript>`
        };
      }
      return {
        status: 200,
        url,
        text: async () => pageHtml
      };
    }) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: videoUrl,
      filters: {
        include_full_transcript: false,
        translateToEnglish: true
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as {
      video_id: string;
      translation_applied: boolean;
      transcript_summary: string;
      transcript_full?: string;
      transcript_strategy_detail?: string;
    };

    expect(attributes.video_id).toBe("abc123def45");
    expect(attributes.translation_applied).toBe(false);
    expect(attributes.transcript_summary.length).toBeGreaterThan(0);
    expect(attributes.transcript_full).toBeUndefined();
    expect(attributes.transcript_strategy_detail).toBe("native_caption_parse");
    expect((fetched?.[0]?.content ?? "").length).toBeLessThan(1200);
  });

  it("handles missing transcripts without requiring them and parses shorts video ids", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    const shortsUrl = "https://www.youtube.com/shorts/shortsVideo123";
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=shortsVideo123";

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(transcriptUrl)) {
        return {
          ok: false,
          status: 500,
          url,
          text: async () => ""
        };
      }
      return {
        status: 200,
        url: shortsUrl,
        text: async () => `<html><body><main>shorts page body text for fallback content</main>\n"captionTracks":[{"baseUrl":"${transcriptUrl.replace(/&/g, "\\u0026")}","languageCode":"es"}]</body></html>`
      };
    }) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: shortsUrl,
      filters: {
        requireTranscript: false,
        translateToEnglish: "false",
        include_full_transcript: "false"
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as {
      video_id: string;
      transcript_available: boolean;
      translation_applied: boolean;
      transcript_strategy_detail?: string;
    };

    expect(attributes.video_id).toBe("shortsVideo123");
    expect(attributes.transcript_available).toBe(false);
    expect(attributes.translation_applied).toBe(false);
    expect(attributes.transcript_strategy_detail).toBe("native_caption_parse");
    expect((fetched?.[0]?.content ?? "").length).toBeGreaterThan(0);
  });

  it("maps page-fetch status and network failures to provider errors", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 401,
      url: "https://www.youtube.com/watch?v=auth",
      text: async () => "auth"
    })) as unknown as typeof fetch);
    await expect(provider.fetch?.({ url: "https://www.youtube.com/watch?v=auth" }, context)).rejects.toMatchObject({ code: "auth" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 429,
      url: "https://www.youtube.com/watch?v=rate",
      text: async () => "rate"
    })) as unknown as typeof fetch);
    await expect(provider.fetch?.({ url: "https://www.youtube.com/watch?v=rate" }, context)).rejects.toMatchObject({ code: "rate_limited" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 503,
      url: "https://www.youtube.com/watch?v=down",
      text: async () => "down"
    })) as unknown as typeof fetch);
    await expect(provider.fetch?.({ url: "https://www.youtube.com/watch?v=down" }, context)).rejects.toMatchObject({
      code: "unavailable",
      retryable: true
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 404,
      url: "https://www.youtube.com/watch?v=missing",
      text: async () => "missing"
    })) as unknown as typeof fetch);
    await expect(provider.fetch?.({ url: "https://www.youtube.com/watch?v=missing" }, context)).rejects.toMatchObject({
      code: "unavailable",
      retryable: false,
      reasonCode: "transcript_unavailable"
    });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    await expect(provider.fetch?.({ url: "https://www.youtube.com/watch?v=net" }, context)).rejects.toMatchObject({ code: "network" });
  });

  it("uses custom search/fetch overrides when provided", async () => {
    const customSearch = vi.fn(async () => ([{
      url: "https://youtube.com/custom-search",
      title: "custom search",
      content: "custom search content"
    }]));
    const customFetch = vi.fn(async () => ({
      url: "https://youtube.com/custom-fetch",
      title: "custom fetch",
      content: "custom fetch content"
    }));

    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      search: customSearch,
      fetch: customFetch
    }));

    const searchResult = await provider.search?.({ query: "override" }, context);
    expect(searchResult?.[0]?.url).toBe("https://youtube.com/custom-search");

    const fetchResult = await provider.fetch?.({ url: "https://youtube.com/custom-fetch" }, context);
    expect(fetchResult?.[0]?.url).toBe("https://youtube.com/custom-fetch");

    expect(customSearch).toHaveBeenCalled();
    expect(customFetch).toHaveBeenCalled();
  });

  it("handles missing caption base URLs and empty snippet fallbacks", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://youtu.be/") {
        return {
          status: 200,
          url,
          text: async () => "<html><body></body></html>"
        };
      }
      return {
        status: 200,
        url: "",
        text: async () => "<html><body>\"captionTracks\":[{\"languageCode\":\"en\"}]</body></html>"
      };
    }) as unknown as typeof fetch);

    const searched = await provider.search?.({ query: "https://youtu.be/" }, context);
    expect(searched?.[0]?.title).toBe("YouTube search: https://youtu.be/");
    expect(searched?.[0]?.attributes.video_id).toBeNull();

    const fetched = await provider.fetch?.({ url: "https://youtu.be/" }, context);
    expect(String(fetched?.[0]?.url ?? "")).toContain("https://youtu.be");
    expect(String(fetched?.[0]?.title ?? "")).toContain("https://youtu.be");
  });

  it("respects string boolean filters for full transcript and translation", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=boolcase12345";

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(transcriptUrl)) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => "<transcript><text>hola uno</text><text>hola dos</text></transcript>"
        };
      }
      return {
        status: 200,
        url: "https://www.youtube.com/watch?v=boolcase12345",
        text: async () => `<html><body><main>bool filter page</main>\"captionTracks\":[{\"baseUrl\":\"${transcriptUrl.replace(/&/g, "\\u0026")}\",\"languageCode\":\"es\"}]</body></html>`
      };
    }) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=boolcase12345",
      filters: {
        include_full_transcript: "true",
        translateToEnglish: "true"
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as {
      transcript_full?: string;
      translation_applied: boolean;
    };
    expect(attributes.translation_applied).toBe(true);
    expect(String(attributes.transcript_full ?? "")).toContain("[translated:es]");
  });

  it("falls back to default boolean filter values for non-boolean strings", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=boolfallback12";

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(transcriptUrl)) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => "<transcript><text>hola fallback</text></transcript>"
        };
      }
      return {
        status: 200,
        url: "https://www.youtube.com/watch?v=boolfallback12",
        text: async () => `<html><body><main>bool fallback page</main>\"captionTracks\":[{\"baseUrl\":\"${transcriptUrl.replace(/&/g, "\\u0026")}\",\"languageCode\":\"es\"}]</body></html>`
      };
    }) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=boolfallback12",
      filters: {
        include_full_transcript: "invalid",
        requireTranscript: "invalid",
        translateToEnglish: "invalid"
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as {
      transcript_full?: string;
      translation_applied: boolean;
    };
    expect(attributes.translation_applied).toBe(true);
    expect(attributes.transcript_full).toBeUndefined();
  });

  it("falls back to request URL when response URL is empty and handles watch URLs without ids", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    const bareWatchUrl = "https://www.youtube.com/watch";

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "",
      text: async () => "<html><body><main>bare watch page body</main>\"captionTracks\":[{\"languageCode\":\"en\"}]</body></html>"
    })) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: bareWatchUrl,
      filters: {
        include_full_transcript: "false",
        requireTranscript: "false"
      }
    }, context);

    expect(fetched?.[0]?.url).toBe(bareWatchUrl);
    expect((fetched?.[0]?.attributes as { video_id: string | null }).video_id).toBeNull();
  });

  it("handles malformed final response URLs in raw youtube fetch handler", async () => {
    const options = withDefaultYouTubeOptions();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "::::not-a-valid-url::::",
      text: async () => "<html><body><main>malformed response url</main></body></html>"
    })) as unknown as typeof fetch);

    const fetched = await options.fetch?.({
      url: "https://www.youtube.com/watch?v=malformedresponse",
      filters: {
        requireTranscript: false
      }
    }, context);

    expect((fetched?.attributes as { video_id: string | null }).video_id).toBeNull();
  });

  it("parses view counts from extracted text when structured view metadata is missing", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=viewcount123",
      text: async () => "<html><body><main>This clip reached 12,345 views this week</main></body></html>"
    })) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=viewcount123",
      filters: {
        include_full_transcript: "false",
        requireTranscript: "false"
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as { views?: number; date_confidence: { source: string } };
    expect(attributes.views).toBe(12345);
    expect(attributes.date_confidence.source).toBe("inferred");
  });

  it("handles invalid publish dates, empty view counts, and non-finite numeric view payloads", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    const hugeViewCount = "9".repeat(400);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=invalidmeta123",
      text: async () => [
        "<html><body><main>metadata fallback text</main>",
        "\"publishDate\":\"not-a-date\"",
        "\"viewCount\":\"abc\"",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    const withEmptyViews = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=invalidmeta123",
      filters: {
        requireTranscript: "false"
      }
    }, context);

    const emptyAttrs = withEmptyViews?.[0]?.attributes as {
      views?: number;
      date_confidence: { source: string };
    };
    expect(emptyAttrs.views).toBeUndefined();
    expect(emptyAttrs.date_confidence.source).toBe("inferred");

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=nonfiniteviews",
      text: async () => [
        "<html><body><main>metadata fallback text</main>",
        "\"viewCount\":\"",
        hugeViewCount,
        "\"",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    const withHugeViews = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=nonfiniteviews",
      filters: {
        requireTranscript: "false",
        include_full_transcript: "false",
        translateToEnglish: "false"
      }
    }, context);
    const hugeAttrs = withHugeViews?.[0]?.attributes as { views?: number };
    expect(hugeAttrs.views).toBeUndefined();
  });

  it("applies youtube_mode filter precedence over config modeDefault", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=modeprecedence123";
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      transcriptResolver: {
        modeDefault: "apify",
        enableApify: false
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(transcriptUrl)) {
        return {
          ok: true,
          status: 200,
          text: async () => "<transcript><text>mode precedence transcript</text></transcript>"
        };
      }
      return {
        status: 200,
        url: "https://www.youtube.com/watch?v=modeprecedence123",
        text: async () => `<html><body><main>mode precedence page</main>\"captionTracks\":[{\"baseUrl\":\"${transcriptUrl.replace(/&/g, "\\u0026")}\",\"languageCode\":\"en\"}]</body></html>`
      };
    }) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=modeprecedence123",
      filters: {
        youtube_mode: "web",
        requireTranscript: true
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as {
      transcript_mode: string;
      transcript_strategy_detail: string;
    };
    expect(attributes.transcript_mode).toBe("web");
    expect(attributes.transcript_strategy_detail).toBe("native_caption_parse");
  });

  it("fails fast for forced youtube_mode when strategy is disabled", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      transcriptResolver: {
        modeDefault: "auto",
        enableYtdlpAudioAsr: false
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=forcedmode123",
      text: async () => "<html><body><main>forced mode page</main></body></html>"
    })) as unknown as typeof fetch);

    await expect(provider.fetch?.({
      url: "https://www.youtube.com/watch?v=forcedmode123",
      filters: {
        youtube_mode: "yt-dlp",
        requireTranscript: true
      }
    }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        transcriptReasonCode: "env_limited"
      }
    });
  });

  it("maps caption_missing transcript failures to transcript_unavailable when transcript is required", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=captionrequired",
      text: async () => "<html><body><main>no captions available</main></body></html>"
    })) as unknown as typeof fetch);

    await expect(provider.fetch?.({
      url: "https://www.youtube.com/watch?v=captionrequired",
      filters: {
        requireTranscript: true
      }
    }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "transcript_unavailable",
      details: {
        transcriptReasonCode: "caption_missing"
      }
    });
  });

  it("surfaces token_required strategy detail when forced apify mode is requested without token", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions());
    vi.stubEnv("APIFY_TOKEN", "");
    vi.stubEnv("APIFY_API_TOKEN", "");

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=apifyforced",
      text: async () => "<html><body><main>no captions available</main></body></html>"
    })) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=apifyforced",
      filters: {
        youtube_mode: "apify",
        requireTranscript: false
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as {
      transcript_strategy_detail?: string;
      reasonCode?: string;
    };
    expect(attributes.transcript_strategy_detail).toBe("apify");
    expect(attributes.reasonCode).toBe("token_required");
  });

  it("falls back to last attempted strategy detail when forced yt-dlp mode only yields env_limited attempts", async () => {
    const provider = createYouTubeProvider(withDefaultYouTubeOptions({
      transcriptResolver: {
        modeDefault: "auto",
        enableYtdlpAudioAsr: false
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.youtube.com/watch?v=envlimitedtail",
      text: async () => "<html><body><main>no captions available</main></body></html>"
    })) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({
      url: "https://www.youtube.com/watch?v=envlimitedtail",
      filters: {
        youtube_mode: "yt-dlp",
        requireTranscript: false
      }
    }, context);

    const attributes = fetched?.[0]?.attributes as {
      transcript_strategy_detail?: string;
      reasonCode?: string;
    };
    expect(attributes.transcript_strategy_detail).toBe("ytdlp_audio_asr");
    expect(attributes.reasonCode).toBe("env_limited");
  });
});
