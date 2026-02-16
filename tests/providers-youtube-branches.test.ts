import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYouTubeProvider,
  withDefaultYouTubeOptions,
  validateYouTubeLegalReviewChecklist,
  YOUTUBE_LEGAL_REVIEW_CHECKLIST
} from "../src/providers/social";

const context = {
  trace: { requestId: "yt-branches", ts: new Date().toISOString() },
  timeoutMs: 1000,
  attempt: 1 as const
};

describe("youtube provider branches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
    };

    expect(attributes.video_id).toBe("abc123def45");
    expect(attributes.translation_applied).toBe(false);
    expect(attributes.transcript_summary.length).toBeGreaterThan(0);
    expect(attributes.transcript_full).toBeUndefined();
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
    };

    expect(attributes.video_id).toBe("shortsVideo123");
    expect(attributes.transcript_available).toBe(false);
    expect(attributes.translation_applied).toBe(false);
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
});
