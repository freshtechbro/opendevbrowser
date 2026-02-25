import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveYouTubeTranscript,
  type YouTubeTranscriptLegalChecklist
} from "../src/providers/social/youtube-resolver";

const context = {
  trace: { requestId: "yt-resolver-branches", ts: "2026-02-16T00:00:00.000Z" },
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

const youtubeiBootstrapHtml = (extra = ""): string => `
  <html><body>
  "INNERTUBE_API_KEY":"api-key-123"
  "INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260216.00.00"}}
  "getTranscriptEndpoint":{"params":"CgtsZWdhY3ktcGFyYW1z"}
  ${extra}
  </body></html>
`;

describe("youtube transcript resolver branch coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves transcripts through youtubei strategy", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/youtubei/v1/get_transcript")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            actions: [{
              updateEngagementPanelAction: {
                content: {
                  transcriptRenderer: {
                    body: {
                      transcriptBodyRenderer: {
                        cueGroups: [{
                          transcriptCueGroupRenderer: {
                            cues: [{
                              transcriptCueRenderer: {
                                cue: {
                                  transcriptSegmentRenderer: {
                                    snippet: {
                                      runs: [{ text: "line one" }]
                                    }
                                  }
                                }
                              }
                            }, {
                              transcriptCueRenderer: {
                                cue: {
                                  transcriptSegmentRenderer: {
                                    snippet: {
                                      runs: [{ text: "line two" }]
                                    }
                                  }
                                }
                              }
                            }]
                          }
                        }]
                      }
                    }
                  }
                }
              }
            }]
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
      watchUrl: "https://www.youtube.com/watch?v=youtubei-success",
      pageHtml: youtubeiBootstrapHtml(),
      legalChecklist: createChecklist(["youtubei", "native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected youtubei success");
    expect(result.text).toBe("line one\nline two");
    expect(result.transcriptStrategy).toBe("native_caption_parse");
    expect(result.transcriptStrategyDetail).toBe("youtubei");
    expect(result.attemptChain).toEqual([{ strategy: "youtubei", ok: true }]);
  });

  it("falls back to native captions when youtubei bootstrap is missing", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=native-fallback";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      ok: true,
      status: 200,
      text: async () => {
        const url = String(input);
        if (url.includes("fmt=json3")) {
          return JSON.stringify({
            events: [{ segs: [{ utf8: "native fallback" }] }]
          });
        }
        return "";
      }
    })) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=native-fallback",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]</body></html>`,
      legalChecklist: createChecklist(["youtubei", "native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected native fallback success");
    expect(result.transcriptStrategyDetail).toBe("native_caption_parse");
    expect(result.attemptChain).toMatchObject([
      { strategy: "youtubei", ok: false, reasonCode: "caption_missing" },
      { strategy: "native_caption_parse", ok: true }
    ]);
  });

  it("falls back after youtubei rate limit responses", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=rate-fallback";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/youtubei/v1/get_transcript")) {
        return {
          ok: false,
          status: 429,
          text: async () => ""
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [{ segs: [{ utf8: "native after rate limit" }] }]
        })
      };
    }) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=rate-fallback",
      pageHtml: youtubeiBootstrapHtml(`"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]`),
      legalChecklist: createChecklist(["youtubei", "native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected fallback success");
    expect(result.attemptChain).toMatchObject([
      { strategy: "youtubei", ok: false, reasonCode: "rate_limited" },
      { strategy: "native_caption_parse", ok: true }
    ]);
  });

  it("falls back after malformed youtubei payloads", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=malformed-fallback";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/youtubei/v1/get_transcript")) {
        return {
          ok: true,
          status: 200,
          text: async () => "{not-json"
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [{ segs: [{ utf8: "native after malformed" }] }]
        })
      };
    }) as unknown as typeof fetch);

    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=malformed-fallback",
      pageHtml: youtubeiBootstrapHtml(`"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]`),
      legalChecklist: createChecklist(["youtubei", "native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected fallback success");
    expect(result.attemptChain).toMatchObject([
      { strategy: "youtubei", ok: false, reasonCode: "transcript_unavailable" },
      { strategy: "native_caption_parse", ok: true }
    ]);
  });
});
