import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import { promisify } from "util";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock("child_process", () => ({
  execFile: execFileMock
}));

type PromisifiedExec = (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>;

const configureExecSuccess = async (): Promise<void> => {
  const custom = vi.fn(async (...args: unknown[]) => {
    execFileMock(...args);
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

const configureExecError = (message: string): void => {
  const custom = vi.fn(async (...args: unknown[]) => {
    execFileMock(...args);
    throw new Error(message);
  });
  (execFileMock as unknown as { [promisify.custom]: PromisifiedExec })[promisify.custom] = custom;
};

const context = {
  trace: { requestId: "yt-resolver-audio-asr", ts: "2026-02-16T00:00:00.000Z" },
  timeoutMs: 1000,
  attempt: 1 as const
};

const legalChecklist = {
  approvalExpiryDate: "2030-12-31T00:00:00.000Z",
  signedOff: true,
  approvedTranscriptStrategies: ["ytdlp_audio_asr"] as const
};

describe("youtube transcript resolver ytdlp_audio_asr strategy", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    delete (execFileMock as Record<PropertyKey, unknown>)[promisify.custom];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("downloads audio with yt-dlp and transcribes via ASR", async () => {
    await configureExecSuccess();
    const asrTranscribe = vi.fn(async () => ({ text: "from downloaded audio", language: "en" }));

    const { resolveYouTubeTranscript } = await import("../src/providers/social/youtube-resolver");
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=audio-asr-success",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist,
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe
    });

    expect(execFileMock).toHaveBeenCalledOnce();
    expect(asrTranscribe).toHaveBeenCalledOnce();
    expect(asrTranscribe.mock.calls[0]?.[0]).toMatchObject({
      watchUrl: "https://www.youtube.com/watch?v=audio-asr-success"
    });
    expect(String(asrTranscribe.mock.calls[0]?.[0]?.audioFilePath ?? "")).toContain(".mp3");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ytdlp audio ASR success");
    expect(result.mode).toBe("yt-dlp");
    expect(result.transcriptStrategy).toBe("optional_asr");
    expect(result.transcriptStrategyDetail).toBe("ytdlp_audio_asr");
    expect(result.text).toContain("from downloaded audio");
  });

  it("maps missing yt-dlp binary to env_limited", async () => {
    configureExecError("spawn yt-dlp ENOENT");

    const { resolveYouTubeTranscript } = await import("../src/providers/social/youtube-resolver");
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=audio-asr-enoent",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist,
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "unused" })
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "env_limited"
    });
  });

  it("maps yt-dlp timeout errors to transcript_unavailable", async () => {
    configureExecError("yt-dlp command timed out");

    const { resolveYouTubeTranscript } = await import("../src/providers/social/youtube-resolver");
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=audio-asr-timeout",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist,
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: true
      },
      asrTranscribe: async () => ({ text: "unused" })
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "transcript_unavailable"
    });
  });

  it("fails fast in forced yt-dlp mode when strategy is disabled", async () => {
    await configureExecSuccess();

    const { resolveYouTubeTranscript } = await import("../src/providers/social/youtube-resolver");
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=audio-asr-disabled",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist,
      config: {
        modeDefault: "yt-dlp",
        enableYtdlpAudioAsr: false
      },
      asrTranscribe: async () => ({ text: "unused" })
    });

    expect(execFileMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "env_limited"
    });
  });

  it("records deprecated ytdlp_subtitle alias diagnostics without breaking callers", async () => {
    await configureExecSuccess();

    const { resolveYouTubeTranscript } = await import("../src/providers/social/youtube-resolver");
    const result = await resolveYouTubeTranscript({
      context,
      watchUrl: "https://www.youtube.com/watch?v=audio-asr-alias",
      pageHtml: "<html><body>no caption block</body></html>",
      legalChecklist,
      config: {
        modeDefault: "yt-dlp",
        enableYtdlp: true,
        strategyOrder: ["native_caption_parse", "ytdlp_subtitle"]
      },
      asrTranscribe: async () => ({ text: "alias path transcript", language: "en" })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected alias success");
    expect(result.transcriptStrategyDetail).toBe("ytdlp_audio_asr");
    expect(result.attemptChain.at(-1)?.message).toContain("legacy ytdlp_subtitle alias");
  });
});
