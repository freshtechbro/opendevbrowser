import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveYouTubeTranscript,
  type YouTubeTranscriptLegalChecklist
} from "../src/providers/social/youtube-resolver";

const context = {
  trace: { requestId: "yt-resolver-apify", ts: "2026-02-16T00:00:00.000Z" },
  timeoutMs: 1000,
  attempt: 1 as const
};

const createChecklist = (
  strategies: YouTubeTranscriptLegalChecklist["approvedTranscriptStrategies"]
): YouTubeTranscriptLegalChecklist => ({
  approvalExpiryDate: "2030-12-31T00:00:00.000Z",
  signedOff: true,
  approvedTranscriptStrategies: strategies
});

describe("youtube transcript resolver apify strategy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("resolves transcript via apify in forced mode", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/v2/acts/") && url.includes("/runs")) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({
            data: {
              defaultDatasetId: "dataset-1"
            }
          })
        };
      }
      if (url.includes("/v2/datasets/dataset-1/items")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            {
              transcript: "apify transcript text",
              languageCode: "en"
            }
          ])
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => ""
      };
    }) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-success",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true,
        apifyActorId: "streamers/youtube-scraper"
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected apify success");
    expect(result.mode).toBe("apify");
    expect(result.transcriptStrategy).toBe("optional_asr");
    expect(result.transcriptStrategyDetail).toBe("apify");
    expect(result.text).toContain("apify transcript text");
  });

  it("fails fast with token_required when APIFY_TOKEN is missing", async () => {
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-missing-token",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "token_required"
    });
  });

  it("maps non-OK apify responses to reason codes", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => ""
    })) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-401",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "token_required"
    });
  });

  it("returns transcript_unavailable when apify payload is malformed", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/v2/acts/") && url.includes("/runs")) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({
            data: {
              defaultDatasetId: "dataset-malformed"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ title: "missing transcript" }])
      };
    }) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-malformed",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "transcript_unavailable"
    });
  });

  it("uses apify in auto mode only after prior strategies fail", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/youtubei/v1/get_transcript")) {
        return {
          ok: false,
          status: 500,
          text: async () => ""
        };
      }
      if (url.includes("/v2/acts/") && url.includes("/runs")) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({
            data: {
              defaultDatasetId: "dataset-auto"
            }
          })
        };
      }
      if (url.includes("/v2/datasets/dataset-auto/items")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            {
              subtitles: [{ text: "auto mode apify fallback" }],
              language: "en"
            }
          ])
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => ""
      };
    }) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-auto-fallback",
      pageHtml: `
        <html><body>
          "INNERTUBE_API_KEY":"api-key"
          "INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260216.00.00"}}
          "getTranscriptEndpoint":{"params":"CgtsZWdhY3ktcGFyYW1z"}
        </body></html>
      `,
      legalChecklist: createChecklist(["native_caption_parse", "apify", "youtubei"]),
      config: {
        modeDefault: "auto",
        enableApify: true,
        enableYtdlpAudioAsr: false
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected auto-mode apify success");
    expect(result.transcriptStrategyDetail).toBe("apify");
    expect(result.attemptChain.map((attempt) => attempt.strategy)).toEqual([
      "youtubei",
      "native_caption_parse",
      "ytdlp_audio_asr",
      "apify"
    ]);
  });
});
