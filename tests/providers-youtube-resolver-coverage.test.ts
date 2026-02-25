import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import type { YouTubeTranscriptLegalChecklist } from "../src/providers/social/youtube-resolver";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock("child_process", () => ({
  execFile: execFileMock
}));

type PromisifiedExec = (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>;
type ResolverModule = typeof import("../src/providers/social/youtube-resolver");
type ResolveTranscriptArgs = Parameters<ResolverModule["resolveYouTubeTranscript"]>[0];
type ResolveTranscriptResult = Awaited<ReturnType<ResolverModule["resolveYouTubeTranscript"]>>;
type ResolveConfigArgs = Parameters<ResolverModule["resolveYouTubeTranscriptConfig"]>[0];
type ResolveConfigResult = ReturnType<ResolverModule["resolveYouTubeTranscriptConfig"]>;

const context = {
  trace: { requestId: "yt-resolver-coverage", ts: "2026-02-16T00:00:00.000Z" },
  timeoutMs: 1000,
  attempt: 1 as const
};

const resolveTranscript = async (
  args: ResolveTranscriptArgs
): Promise<ResolveTranscriptResult> => {
  vi.resetModules();
  const { resolveYouTubeTranscript } = await import("../src/providers/social/youtube-resolver");
  return resolveYouTubeTranscript(args);
};

const resolveTranscriptConfig = async (
  config: ResolveConfigArgs
): Promise<ResolveConfigResult> => {
  vi.resetModules();
  const { resolveYouTubeTranscriptConfig } = await import("../src/providers/social/youtube-resolver");
  return resolveYouTubeTranscriptConfig(config);
};

const findCaptionBaseUrlFromHtml = async (html: string): Promise<string | null> => {
  vi.resetModules();
  const { findCaptionBaseUrl } = await import("../src/providers/social/youtube-resolver");
  return findCaptionBaseUrl(html);
};

const createChecklist = (
  strategies: YouTubeTranscriptLegalChecklist["approvedTranscriptStrategies"],
  options?: { expiry?: string; signedOff?: boolean }
): YouTubeTranscriptLegalChecklist => ({
  approvalExpiryDate: options?.expiry ?? "2030-12-31T00:00:00.000Z",
  signedOff: options?.signedOff ?? true,
  approvedTranscriptStrategies: strategies
});

const setExecSuccess = async (options?: { createAudio?: boolean }): Promise<void> => {
  const createAudio = options?.createAudio ?? true;
  const custom = vi.fn(async (...args: unknown[]) => {
    execFileMock(...args);
    if (!createAudio) {
      return { stdout: "", stderr: "" };
    }
    const commandArgs = Array.isArray(args[1]) ? args[1] as string[] : [];
    const outputIndex = commandArgs.indexOf("-o");
    const outputTemplate = outputIndex >= 0 ? commandArgs[outputIndex + 1] : null;
    if (typeof outputTemplate === "string") {
      const audioPath = outputTemplate.replace("%(ext)s", "mp3");
      await mkdir(path.dirname(audioPath), { recursive: true });
      await writeFile(audioPath, "fake-audio");
    }
    return { stdout: "", stderr: "" };
  });
  (execFileMock as unknown as { [promisify.custom]: PromisifiedExec })[promisify.custom] = custom;
};

const setExecThrow = (error: unknown): void => {
  const custom = vi.fn(async (...args: unknown[]) => {
    execFileMock(...args);
    throw error;
  });
  (execFileMock as unknown as { [promisify.custom]: PromisifiedExec })[promisify.custom] = custom;
};

describe("youtube transcript resolver branch coverage", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    delete (execFileMock as Record<PropertyKey, unknown>)[promisify.custom];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls back to auto mode when modeDefault is invalid", async () => {
    const config = await resolveTranscriptConfig({ modeDefault: "bad-mode" as never });
    expect(config.modeDefault).toBe("auto");
  });

  it("handles malformed caption tracks JSON blocks", async () => {
    await expect(findCaptionBaseUrlFromHtml('"captionTracks":[{"baseUrl":"https://bad"')).resolves.toBeNull();
  });

  it("normalizes config clamps and defaults for blank actor id", async () => {
    const config = await resolveTranscriptConfig({
      modeDefault: "invalid" as never,
      strategyOrder: ["youtubei"],
      ytdlpTimeoutMs: 999999,
      apifyActorId: "   "
    });

    expect(config.modeDefault).toBe("auto");
    expect(config.strategyOrder[0]).toBe("native_caption_parse");
    expect(config.ytdlpTimeoutMs).toBe(120000);
    expect(config.apifyActorId).toBe("streamers/youtube-scraper");
  });

  it("expands optional_asr ordering and appends missing auto-mode strategies", async () => {
    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=optional-ordering",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["youtubei", "native_caption_parse"]),
      config: {
        modeDefault: "auto",
        strategyOrder: ["optional_asr"],
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.attemptChain.map((attempt) => attempt.strategy)).toEqual([
      "native_caption_parse",
      "ytdlp_audio_asr",
      "apify",
      "youtubei"
    ]);
  });

  it("falls back to auto mode when request and config modes are invalid", async () => {
    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=invalid-mode-fallback",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse"]),
      mode: "invalid" as never,
      config: {
        modeDefault: "also-invalid" as never,
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.mode).toBe("auto");
    expect(result.reasonCode).toBe("caption_missing");
  });

  it("handles caption block markers without opening arrays and escaped strings", async () => {
    await expect(findCaptionBaseUrlFromHtml('"captionTracks":{}')).resolves.toBeNull();

    const escapedUrl = await findCaptionBaseUrlFromHtml(
      '<html><body>"captionTracks":[{"baseUrl":"https:\\/\\/example.com\\/api\\?q=12","languageCode":"en"}]</body></html>'
    );
    expect(escapedUrl).toBeNull();
  });

  it("parses escaped slash caption URLs and ignores non-object caption entries", async () => {
    const baseUrl = await findCaptionBaseUrlFromHtml(
      '<html><body>"captionTracks":[null,"skip",{"baseUrl":"https:\\/\\/example.com\\/timedtext","languageCode":"en"}]</body></html>'
    );
    expect(baseUrl).toBe("https://example.com/timedtext");
  });

  it("prefers english manual tracks and falls back to locale compare when english priority ties", async () => {
    const baseUrl = await findCaptionBaseUrlFromHtml(`
      <html><body>
      "captionTracks":[
        {"baseUrl":"https://www.youtube.com/api/timedtext?v=fr-manual","languageCode":"fr"},
        {"baseUrl":"https://www.youtube.com/api/timedtext?v=en-gb-manual","languageCode":"en-GB"},
        {"baseUrl":"https://www.youtube.com/api/timedtext?v=en-us-manual","languageCode":"en-US"}
      ]
      </body></html>
    `);

    expect(baseUrl).toContain("en-gb-manual");
  });

  it("handles caption name parsing branches and locale tie-breaks", async () => {
    const esUrl = "https://www.youtube.com/api/timedtext?v=es-track";
    const frUrl = "https://www.youtube.com/api/timedtext?v=fr-track";
    const autoUrl = "https://www.youtube.com/api/timedtext?v=auto-track";

    const html = `
      <html><body>
      "captionTracks":[
        {"baseUrl":"${esUrl}","languageCode":"es","name":{}},
        {"baseUrl":"${frUrl}","languageCode":"fr","name":{"runs":[{"text":"Manuel"}]}},
        {"baseUrl":"${autoUrl}","languageCode":"en","name":{"simpleText":"English (auto-generated)"}}
      ]
      </body></html>
    `;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(esUrl) && url.includes("fmt=json3")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ events: [{ segs: [{ utf8: "hola" }] }] })
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => ""
      };
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=locale-branch",
      pageHtml: html,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "auto",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.language).toBe("es");
  });

  it("parses VTT transcripts when json3 is unavailable", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=vtt-branch";

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fmt=json3")) {
        return {
          ok: true,
          status: 200,
          text: async () => "not-json"
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => [
          "WEBVTT",
          "",
          "00:00:00.000 --> 00:00:01.000",
          "vtt line one",
          "",
          "1",
          "00:00:01.000 --> 00:00:02.000",
          "vtt line two"
        ].join("\n")
      };
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=vtt-branch",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]</body></html>`,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "auto",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.text).toBe("vtt line one\nvtt line two");
  });

  it("handles native caption fetch network errors and fallback failures", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=network-fail";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=network-fail",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]</body></html>`,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "auto",
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "transcript_unavailable"
    });
  });

  it("records native caption json3 auth failures in attempt diagnostics", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=auth-native";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fmt=json3")) {
        return {
          ok: false,
          status: 401,
          text: async () => ""
        };
      }
      return {
        ok: false,
        status: 500,
        text: async () => ""
      };
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=auth-native",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]</body></html>`,
      legalChecklist: createChecklist(["youtubei", "native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "caption_missing"
    });
    if (result.ok) throw new Error("Expected failure");
    expect(result.attemptChain.some((attempt) => (
      attempt.strategy === "native_caption_parse"
      && attempt.reasonCode === "token_required"
    ))).toBe(true);
  });

  it("handles native caption fallback non-ok and empty payload branches", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=fallback-branches";

    const nonOkFallback = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fmt=json3")) {
        return {
          ok: true,
          status: 200,
          text: async () => "{}"
        };
      }
      return {
        ok: false,
        status: 500,
        text: async () => ""
      };
    });
    vi.stubGlobal("fetch", nonOkFallback as unknown as typeof fetch);

    const nonOkResult = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=fallback-non-ok",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]</body></html>`,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });
    expect(nonOkResult).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });

    const emptyFallback = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fmt=json3")) {
        return {
          ok: true,
          status: 200,
          text: async () => "{}"
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => ""
      };
    });
    vi.stubGlobal("fetch", emptyFallback as unknown as typeof fetch);

    const emptyResult = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=fallback-empty",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]</body></html>`,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });
    expect(emptyResult).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });
  });

  it("handles invalid caption URLs without crashing query-param normalization", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => ""
    })) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=invalid-caption-url",
      pageHtml: '<html><body>"captionTracks":[{"baseUrl":"::invalid-url::","languageCode":"en"}]</body></html>',
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(false);
  });

  it("treats kind/vssId auto tracks as ineligible in no-auto mode", async () => {
    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=manual-only-auto-tracks",
      pageHtml: `
        <html><body>
          "captionTracks":[
            {"baseUrl":"https://www.youtube.com/api/timedtext?v=auto-kind","languageCode":"en","kind":"asr"},
            {"baseUrl":"https://www.youtube.com/api/timedtext?v=auto-vss","languageCode":"en","vssId":"a.en"}
          ]
        </body></html>
      `,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "no-auto",
      }
    });

    expect(result).toMatchObject({ ok: false, reasonCode: "caption_missing" });
  });

  it("parses sparse json3 payloads and falls back to unknown language when languageCode is empty", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=json3-sparse";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        events: [null, { segs: null }, { segs: [null, { utf8: 7 }, { utf8: "hola" }] }]
      })
    })) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=json3-sparse",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":""}]</body></html>`,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.text).toBe("hola");
    expect(result.language).toBe("unknown");
  });

  it("falls back to non-json caption payload with unknown language when json3 is empty", async () => {
    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=xml-fallback-unknown-language";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fmt=json3")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ events: [] })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "<text>xml fallback line</text>"
      };
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=xml-fallback-unknown-language",
      pageHtml: `<html><body>"captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":""}]</body></html>`,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.text).toBe("xml fallback line");
    expect(result.language).toBe("unknown");
  });

  it("resolves youtubei context from legacy client-name/version fields and language from payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (!url.includes("/youtubei/v1/get_transcript")) {
        return {
          ok: false,
          status: 404,
          text: async () => ""
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          languageCode: "de",
          transcriptSegmentRenderer: {
            snippet: {
              runs: [{ text: "guten tag" }]
            }
          }
        })
      };
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=youtubei-legacy-context",
      pageHtml: `
        <html><body>
          "INNERTUBE_API_KEY":"legacy-key"
          "INNERTUBE_CONTEXT_CLIENT_NAME":"WEB"
          "INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260216.00.00"
          "getTranscriptEndpoint":{"params":"legacy-params"}
        </body></html>
      `,
      legalChecklist: createChecklist(["youtubei"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected youtubei success");
    expect(result.language).toBe("de");
  });

  it("covers youtubei request failure and missing-segment branches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);

    const requestFailure = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=youtubei-request-fail",
      pageHtml: `
        <html><body>
          "INNERTUBE_API_KEY":"legacy-key"
          "INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260216.00.00"}}
          "getTranscriptEndpoint":{"params":"legacy-params"}
        </body></html>
      `,
      legalChecklist: createChecklist(["youtubei"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(requestFailure.ok).toBe(false);
    if (requestFailure.ok) throw new Error("Expected failure");
    expect(requestFailure.attemptChain).toContainEqual(
      expect.objectContaining({ strategy: "youtubei", ok: false, reasonCode: "transcript_unavailable" })
    );

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ actions: [] })
    })) as unknown as typeof fetch);

    const missingSegments = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=youtubei-no-segments",
      pageHtml: `
        <html><body>
          "INNERTUBE_API_KEY":"legacy-key"
          "INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260216.00.00"}}
          "getTranscriptEndpoint":{"params":"legacy-params"}
        </body></html>
      `,
      legalChecklist: createChecklist(["youtubei"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(missingSegments.ok).toBe(false);
    if (missingSegments.ok) throw new Error("Expected failure");
    expect(missingSegments.attemptChain).toContainEqual(
      expect.objectContaining({ strategy: "youtubei", ok: false, reasonCode: "transcript_unavailable" })
    );
  });

  it("handles youtubei sparse segment payloads and run-text edge cases", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        actions: [
          null,
          { transcriptSegmentRenderer: { snippet: { simpleText: "Hallo" } } },
          [
            null,
            {
              transcriptSegmentRenderer: {
                snippet: { runs: [null, { text: 9 }, { text: " Welt" }] }
              }
            }
          ],
          { transcriptSegmentRenderer: { snippet: {} } },
          { nested: { languageCode: "it" } }
        ]
      })
    })) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=youtubei-segment-edges",
      pageHtml: `
        <html><body>
          "INNERTUBE_API_KEY":"legacy-key"
          "INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260216.00.00"}}
          "getTranscriptEndpoint":{"params":"legacy-params"}
        </body></html>
      `,
      legalChecklist: createChecklist(["youtubei"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected youtubei success");
    expect(result.text).toContain("Hallo");
    expect(result.text).toContain("Welt");
    expect(result.language).toBe("it");
  });

  it("skips youtubei null snippets and null language nodes while preserving valid segments", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        actions: [
          { transcriptSegmentRenderer: { snippet: null } },
          { transcriptSegmentRenderer: { snippet: { runs: [{ text: "one" }] } } },
          { metadata: { languageCode: "pt", extra: null } }
        ]
      })
    })) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=youtubei-null-snippet",
      pageHtml: `
        <html><body>
          "INNERTUBE_API_KEY":"legacy-key"
          "INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260216.00.00"}}
          "getTranscriptEndpoint":{"params":"legacy-params"}
        </body></html>
      `,
      legalChecklist: createChecklist(["youtubei"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected youtubei success");
    expect(result.text).toBe("one");
    expect(result.language).toBe("pt");
  });

  it("maps yt-dlp execution failures for rate-limit, token, and generic branches", async () => {
    setExecThrow("429 too many requests");
    const rateLimited = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=ytdlp-rate",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["ytdlp_audio_asr"]),
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "unused" })
    });
    expect(rateLimited).toMatchObject({ ok: false, reasonCode: "rate_limited" });

    setExecThrow(new Error("403 forbidden"));
    const tokenRequired = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=ytdlp-token",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["ytdlp_audio_asr"]),
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "unused" })
    });
    expect(tokenRequired).toMatchObject({ ok: false, reasonCode: "token_required" });

    setExecThrow(new Error("subprocess crashed"));
    const generic = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=ytdlp-generic",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["ytdlp_audio_asr"]),
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "unused" })
    });
    expect(generic).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });
  });

  it("covers yt-dlp no-audio and empty-ASR branches", async () => {
    await setExecSuccess({ createAudio: false });
    const noAudio = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=ytdlp-no-audio",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["ytdlp_audio_asr"]),
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "unused" })
    });
    expect(noAudio).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });

    await setExecSuccess({ createAudio: true });
    const emptyAsr = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=ytdlp-empty-asr",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["ytdlp_audio_asr"]),
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "   " })
    });
    expect(emptyAsr).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });
  });

  it("uses optional_asr legal compatibility and unknown language fallback for yt-dlp audio ASR", async () => {
    await setExecSuccess({ createAudio: true });
    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=ytdlp-optional-asr-legal",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["optional_asr"]),
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "asr fallback text" })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.language).toBe("unknown");
    expect(result.transcriptStrategy).toBe("optional_asr");
    expect(result.transcriptStrategyDetail).toBe("ytdlp_audio_asr");
  });

  it("accepts legacy ytdlp_subtitle legal approval alias for yt-dlp audio ASR", async () => {
    await setExecSuccess({ createAudio: true });
    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=ytdlp-legacy-legal",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["ytdlp_subtitle"]),
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "legacy legal alias transcript" })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.transcriptStrategyDetail).toBe("ytdlp_audio_asr");
  });

  it("covers apify actor/dataset fetch failure branches", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("apify unavailable");
    }) as unknown as typeof fetch);
    const actorFetchFail = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-fetch-fail",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });
    expect(actorFetchFail).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ data: {} })
    })) as unknown as typeof fetch);
    const missingDataset = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-missing-dataset",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });
    expect(missingDataset).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ data: { defaultDatasetId: "dataset-1" } })
        };
      }
      throw new Error("dataset fetch failed");
    }) as unknown as typeof fetch);
    const datasetFetchFail = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-dataset-fetch-fail",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });
    expect(datasetFetchFail).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });

    callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ data: { defaultDatasetId: "dataset-1" } })
        };
      }
      return {
        ok: false,
        status: 429,
        text: async () => ""
      };
    }) as unknown as typeof fetch);
    const datasetNonOk = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-dataset-429",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });
    expect(datasetNonOk).toMatchObject({ ok: false, reasonCode: "rate_limited" });
  });

  it("handles mixed apify transcript item shapes and unknown language fallback", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ data: { defaultDatasetId: "dataset-2" } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          "skip",
          {
            transcript: [{ text: "line one" }, "line two", { text: 5 }, null],
            language: 42
          }
        ])
      };
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-mixed-items",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.language).toBe("unknown");
    expect(result.text).toContain("line one");
    expect(result.text).toContain("line two");
  });

  it("returns transcript_unavailable when apify dataset payload is not an array", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ data: { defaultDatasetId: "dataset-3" } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ transcript: "not-array" })
      };
    }) as unknown as typeof fetch);

    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-dataset-object",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"]),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });

    expect(result).toMatchObject({ ok: false, reasonCode: "transcript_unavailable" });
  });

  it("covers legal gate branches for forced and non-forced modes", async () => {
    vi.stubEnv("APIFY_TOKEN", "token-123");

    const forcedLegalFail = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=legal-expired",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["apify"], { expiry: "2020-01-01T00:00:00.000Z" }),
      config: {
        modeDefault: "apify",
        enableApify: true
      }
    });

    expect(forcedLegalFail).toMatchObject({ ok: false, reasonCode: "strategy_unapproved" });

    const transcriptUrl = "https://www.youtube.com/api/timedtext?v=legal-continue";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fmt=json3")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ events: [{ segs: [{ utf8: "native after legal skip" }] }] })
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => ""
      };
    }) as unknown as typeof fetch);

    const nonForcedLegalSkip = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=legal-continue",
      pageHtml: `
        <html><body>
          "INNERTUBE_API_KEY":"legacy-key"
          "INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260216.00.00"}}
          "getTranscriptEndpoint":{"params":"legacy-params"}
          "captionTracks":[{"baseUrl":"${transcriptUrl}","languageCode":"en"}]
        </body></html>
      `,
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
      }
    });

    expect(nonForcedLegalSkip.ok).toBe(true);
    if (!nonForcedLegalSkip.ok) throw new Error("Expected success");
    expect(nonForcedLegalSkip.attemptChain).toMatchObject([
      { strategy: "youtubei", ok: false, reasonCode: "strategy_unapproved" },
      { strategy: "native_caption_parse", ok: true }
    ]);
  });

  it("covers precheck branches for missing ASR, apify disabled, and alias diagnostics", async () => {
    const missingAsr = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=missing-asr",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse", "ytdlp_audio_asr"]),
      config: {
        modeDefault: "no-auto",
        enableYtdlpAudioAsr: true,
        strategyOrder: ["native_caption_parse", "ytdlp_subtitle"]
      }
    });

    expect(missingAsr).toMatchObject({ ok: false, reasonCode: "caption_missing" });
    if (missingAsr.ok) throw new Error("Expected failure");
    expect(missingAsr.attemptChain.some((attempt) => attempt.message?.includes("legacy ytdlp_subtitle alias"))).toBe(true);

    const apifyDisabled = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=apify-disabled",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse", "apify"]),
      config: {
        modeDefault: "auto",
        enableYtdlpAudioAsr: false,
        enableApify: false
      }
    });

    expect(apifyDisabled.ok).toBe(false);
    if (apifyDisabled.ok) throw new Error("Expected failure");
    expect(apifyDisabled.attemptChain.some((attempt) => attempt.strategy === "apify" && attempt.reasonCode === "env_limited")).toBe(true);
  });

  it("covers browser fallback HTML-missing and native-failure branches", async () => {
    const noHtml = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=fallback-no-html",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
        enableBrowserFallback: true,
      },
      browserFallbackPort: {
        resolve: async () => ({
          ok: true,
          reasonCode: "transcript_unavailable",
          output: {}
        })
      },
      allowBrowserFallbackEscalation: true
    });
    expect(noHtml).toMatchObject({ ok: false, reasonCode: "env_limited" });

    const nativeFailure = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=fallback-native-fail",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "web",
        enableBrowserFallback: true,
      },
      browserFallbackPort: {
        resolve: async () => ({
          ok: true,
          reasonCode: "transcript_unavailable",
          output: {
            html: "<html><body>still no captions</body></html>"
          }
        })
      },
      allowBrowserFallbackEscalation: true
    });
    expect(nativeFailure).toMatchObject({ ok: false, reasonCode: "caption_missing" });
  });

  it("uses default browser fallback failure message when details.message is absent", async () => {
    const result = await resolveTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=fallback-error-default-message",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["youtubei", "native_caption_parse"]),
      config: {
        modeDefault: "web",
        enableBrowserFallback: true,
      },
      browserFallbackPort: {
        resolve: async () => ({
          ok: false,
          reasonCode: "env_limited",
          details: {}
        })
      },
      allowBrowserFallbackEscalation: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.attemptChain.at(-1)).toMatchObject({
      strategy: "browser_assisted",
      ok: false,
      reasonCode: "env_limited",
      message: "Browser fallback failed."
    });
  });
});
