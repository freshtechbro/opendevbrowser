import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveYouTubeTranscript,
  resolveYouTubeTranscriptConfig,
  type YouTubeTranscriptLegalChecklist
} from "../src/providers/social/youtube-resolver";

const context = {
  trace: { requestId: "yt-resolver-ytdlp", ts: "2026-02-16T00:00:00.000Z" },
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

describe("youtube transcript resolver yt-dlp mode compatibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes ytdlp alias to yt-dlp in resolver config", () => {
    const config = resolveYouTubeTranscriptConfig({
      modeDefault: "ytdlp" as never
    });
    expect(config.modeDefault).toBe("yt-dlp");
  });

  it("fails fast in forced yt-dlp mode when strategy is disabled", async () => {
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=forced-ytdlp-disabled",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["ytdlp_audio_asr"]),
      config: {
        modeDefault: "ytdlp" as never,
        enableYtdlpAudioAsr: false
      },
      asrTranscribe: async () => ({ text: "unused" })
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "yt-dlp",
      reasonCode: "env_limited"
    });
    if (result.ok) throw new Error("Expected failure");
    expect(result.attemptChain).toEqual([
      {
        strategy: "ytdlp_audio_asr",
        ok: false,
        reasonCode: "env_limited",
        message: "yt-dlp audio ASR strategy is disabled by configuration."
      }
    ]);
  });

  it("keeps caption_missing as the terminal reason when yt-dlp is disabled in auto mode", async () => {
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=auto-disabled-ytdlp",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist: createChecklist(["native_caption_parse"]),
      config: {
        modeDefault: "auto",
        enableYtdlpAudioAsr: false
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "caption_missing"
    });
  });
});
