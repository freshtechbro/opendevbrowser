import { afterEach, describe, expect, it, vi } from "vitest";
import { createYouTubeProvider, withDefaultYouTubeOptions } from "../src/providers/social";

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
});
