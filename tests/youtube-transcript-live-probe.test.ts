import { describe, expect, it } from "vitest";
import {
  classifyTranscriptProbeFailure,
  DEFAULT_YOUTUBE_TRANSCRIPT_MODE,
  DEFAULT_YOUTUBE_TRANSCRIPT_PROBE_URL,
  parseArgs,
  TRANSCRIPT_ENV_LIMITED_REASON_CODES,
  YOUTUBE_TRANSCRIPT_PROBE_STEP_ID
} from "../scripts/youtube-transcript-live-probe.mjs";

describe("youtube-transcript-live-probe script", () => {
  it("parses defaults and stable transcript probe metadata", () => {
    const parsed = parseArgs([]);

    expect(parsed.url).toBe(DEFAULT_YOUTUBE_TRANSCRIPT_PROBE_URL);
    expect(parsed.youtubeMode).toBe(DEFAULT_YOUTUBE_TRANSCRIPT_MODE);
    expect(parsed.out).toContain("/tmp/odb-youtube-transcript-live-probe-");
    expect(YOUTUBE_TRANSCRIPT_PROBE_STEP_ID).toBe("workflow.youtube.transcript");
  });

  it("parses explicit url, mode, timeout, and quiet overrides", () => {
    const parsed = parseArgs([
      "--url",
      "https://www.youtube.com/watch?v=test123",
      "--youtube-mode",
      "apify",
      "--timeout-ms",
      "45000",
      "--quiet"
    ]);

    expect(parsed.url).toBe("https://www.youtube.com/watch?v=test123");
    expect(parsed.youtubeMode).toBe("apify");
    expect(parsed.timeoutMs).toBe(45000);
    expect(parsed.quiet).toBe(true);
  });

  it("maps transcript availability boundaries to env_limited", () => {
    const failure = classifyTranscriptProbeFailure({
      message: "YouTube transcript unavailable (transcript_unavailable)",
      details: {
        reasonCode: "transcript_unavailable",
        transcriptReasonCode: "caption_missing",
        attemptChain: [{ strategy: "youtubei", ok: false, reasonCode: "caption_missing" }]
      }
    });

    expect(TRANSCRIPT_ENV_LIMITED_REASON_CODES.has("caption_missing")).toBe(true);
    expect(failure).toEqual({
      status: "env_limited",
      detail: "reason_codes=caption_missing",
      data: {
        reasonCode: "transcript_unavailable",
        transcriptReasonCode: "caption_missing",
        attemptChain: [{ strategy: "youtubei", ok: false, reasonCode: "caption_missing" }],
        message: "YouTube transcript unavailable (transcript_unavailable)"
      }
    });
  });

  it("keeps unexpected transcript probe errors blocking", () => {
    const failure = classifyTranscriptProbeFailure(new Error("Unexpected malformed transcript payload."));

    expect(failure.status).toBe("fail");
    expect(failure.detail).toBe("Unexpected malformed transcript payload.");
    expect(failure.data).toMatchObject({
      reasonCode: null,
      transcriptReasonCode: null,
      attemptChain: [],
      message: "Unexpected malformed transcript payload."
    });
  });
});
