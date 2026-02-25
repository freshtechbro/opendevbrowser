import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asTranscriptProviderError,
  findCaptionBaseUrl,
  findTranscriptLanguage,
  resolveYouTubeTranscript,
  resolveYouTubeTranscriptConfig,
  type YouTubeTranscriptLegalChecklist
} from "../src/providers/social/youtube-resolver";

const context = {
  trace: { requestId: "yt-resolver", ts: "2026-02-16T00:00:00.000Z" },
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

describe("youtube transcript resolver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("resolves config defaults, mode alias, and legacy ytdlp flags", () => {
    const config = resolveYouTubeTranscriptConfig({
      modeDefault: "ytdlp" as never,
      strategyOrder: ["optional_asr", "ytdlp_subtitle", "optional_asr"],
      ytdlpTimeoutMs: 200,
      enableAsr: true
    });

    expect(config.modeDefault).toBe("yt-dlp");
    expect(config.enableYtdlpAudioAsr).toBe(true);
    expect(config.ytdlpTimeoutMs).toBe(1000);
    expect(config.strategyOrder).toEqual(["native_caption_parse", "optional_asr", "ytdlp_subtitle"]);
  });

  it("extracts caption URL and language from escaped caption payload", () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=caption123&lang=en";
    const html = `"captionTracks":[{"baseUrl":"${transcriptUrl.replace(/&/g, "\\u0026").replace(/\//g, "\\/")}","languageCode":"en-US"}]`;

    expect(findCaptionBaseUrl(html)).toBe(transcriptUrl);
    expect(findTranscriptLanguage(html)).toBe("en-US");
  });

  it("returns null/unknown when caption payload is missing", () => {
    expect(findCaptionBaseUrl("<html><body>no tracks</body></html>")).toBeNull();
    expect(findTranscriptLanguage("<html><body>no tracks</body></html>")).toBe("unknown");
  });

  it("prefers manual caption tracks over ASR and parses json3 transcripts", async () => {
    const manualUrl = "https://www.youtube.com/api/timedtext?v=manual123&lang=fr";
    const autoUrl = "https://www.youtube.com/api/timedtext?v=asr123&lang=en";
    const html = `
      <html><body>
      "captionTracks":[
        {"baseUrl":"${autoUrl}","languageCode":"en","kind":"asr","vssId":"a.en"},
        {"baseUrl":"${manualUrl}","languageCode":"fr","vssId":"fr"}
      ]
      </body></html>
    `;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(manualUrl) && url.includes("fmt=json3")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            events: [
              { segs: [{ utf8: "bonjour" }] },
              { segs: [{ utf8: "tout le monde" }] }
            ]
          })
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
      watchUrl: "https://www.youtube.com/watch?v=manual123",
      pageHtml: html,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "auto",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected native caption success");
    expect(result.transcriptStrategy).toBe("native_caption_parse");
    expect(result.transcriptStrategyDetail).toBe("native_caption_parse");
    expect(result.language).toBe("fr");
    expect(result.text).toBe("bonjour\ntout le monde");
  });

  it("enforces no-auto mode by excluding automatic caption tracks", async () => {
    const autoUrl = "https://www.youtube.com/api/timedtext?v=asr-only&lang=en";
    const html = `
      <html><body>
      "captionTracks":[{"baseUrl":"${autoUrl}","languageCode":"en","kind":"asr","vssId":"a.en"}]
      </body></html>
    `;

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=asr-only",
      pageHtml: html,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "no-auto",
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "caption_missing",
      mode: "no-auto"
    });
  });

  it("does not let disabled strategy skips overwrite caption_missing failures", async () => {
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=nocaptions",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "auto",
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "caption_missing"
    });
    if (result.ok) throw new Error("Expected failure");
    expect(result.attemptChain.some((attempt) => attempt.strategy === "youtubei")).toBe(true);
    expect(result.attemptChain.some((attempt) => attempt.strategy === "apify")).toBe(true);
  });

  it("uses browser-assisted fallback when escalation is enabled", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=browserassist";
    const fallbackHtml = `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl.replace(/&/g, "\\u0026")}","languageCode":"en"}]</body></html>`;
    const fallbackPort = {
      resolve: vi.fn(async () => ({
        ok: true as const,
        reasonCode: "transcript_unavailable" as const,
        mode: "managed_headed" as const,
        output: {
          html: fallbackHtml,
          url: "https://www.youtube.com/watch?v=browserassist"
        }
      }))
    };

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<transcript><text>browser assisted transcript</text></transcript>"
    })) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=browserassist",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
        enableBrowserFallback: true,
      },
      browserFallbackPort: fallbackPort,
      allowBrowserFallbackEscalation: true
    });

    expect(fallbackPort.resolve).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected transcript success");
    expect(result.transcriptStrategy).toBe("browser_assisted");
    expect(result.transcriptStrategyDetail).toBe("browser_assisted");
    expect(result.attemptChain.at(-1)).toMatchObject({ strategy: "browser_assisted", ok: true });
  });

  it("surfaces browser fallback failure reason codes", async () => {
    const fallbackPort = {
      resolve: vi.fn(async () => ({
        ok: false as const,
        reasonCode: "env_limited" as const,
        details: { message: "headed browser unavailable" }
      }))
    };

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=fallbackfail",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
        enableBrowserFallback: true,
      },
      browserFallbackPort: fallbackPort,
      allowBrowserFallbackEscalation: true
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "env_limited"
    });
    if (result.ok) throw new Error("Expected failure");
    expect(result.attemptChain.at(-1)).toMatchObject({
      strategy: "browser_assisted",
      reasonCode: "env_limited"
    });
  });

  it("maps reason codes into transcript provider errors", () => {
    expect(asTranscriptProviderError("policy gated", "strategy_unapproved")).toEqual({
      code: "policy_blocked",
      message: "policy gated",
      reasonCode: "strategy_unapproved",
      details: {
        reasonCode: "strategy_unapproved"
      }
    });
  });
});
