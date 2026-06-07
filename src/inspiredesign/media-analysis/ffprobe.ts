import { spawn } from "child_process";
import {
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES,
  INSPIREDESIGN_MEDIA_ANALYSIS_PROCESS_TIMEOUT_MS,
  type InspiredesignMediaAdapterResult,
  type InspiredesignMediaMetadataFacts
} from "./types";

export type InspiredesignFfprobeRunOptions = {
  binaryPath?: string;
  timeoutMs?: number;
};

export type InspiredesignFfprobeRunner = (
  filePath: string,
  options?: InspiredesignFfprobeRunOptions
) => Promise<InspiredesignMediaAdapterResult<InspiredesignMediaMetadataFacts>>;

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

const DEFAULT_FFPROBE_BINARY = "ffprobe";
const STREAM_TYPE_VIDEO = "video";
const STREAM_TYPE_AUDIO = "audio";
const JSON_PARSE_ERROR_LIMIT = 280;

export const runInspiredesignFfprobe: InspiredesignFfprobeRunner = async (filePath, options = {}) => {
  const binaryPath = options.binaryPath ?? DEFAULT_FFPROBE_BINARY;
  const timeoutMs = options.timeoutMs ?? INSPIREDESIGN_MEDIA_ANALYSIS_PROCESS_TIMEOUT_MS;
  const args = ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath];

  try {
    const result = await runProcess(binaryPath, args, timeoutMs);
    if (result.timedOut) {
      return { limitations: [`ffprobe timed out after ${timeoutMs}ms.`] };
    }
    if (result.exitCode !== 0) {
      return { limitations: [`ffprobe failed with exit code ${result.exitCode ?? "unknown"}.`] };
    }
    return parseFfprobeJson(result.stdout);
  } catch (error) {
    return { limitations: [formatProcessError("ffprobe", error)] };
  }
};

const runProcess = (binaryPath: string, args: string[], timeoutMs: number): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = collectBoundedChunk(stdoutChunks, chunk, stdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = collectBoundedChunk(stderrChunks, chunk, stderrBytes);
    });
    child.on("error", (error) => {
      settle(() => reject(error));
    });
    child.on("close", (exitCode) => {
      settle(() => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode,
          timedOut
        });
      });
    });
  });

const collectBoundedChunk = (chunks: Buffer[], chunk: Buffer, currentBytes: number): number => {
  const remainingBytes = INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES - currentBytes;
  if (remainingBytes <= 0) {
    return currentBytes;
  }
  const safeChunk = chunk.length > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk;
  chunks.push(safeChunk);
  return currentBytes + safeChunk.length;
};

const parseFfprobeJson = (stdout: string): InspiredesignMediaAdapterResult<InspiredesignMediaMetadataFacts> => {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = asRecord(parsed);
    const streams = readRecords(root.streams);
    const format = asRecord(root.format);
    return { value: buildMetadataFacts(streams, format), limitations: [] };
  } catch (error) {
    return { limitations: [`ffprobe JSON could not be parsed: ${String(error).slice(0, JSON_PARSE_ERROR_LIMIT)}`] };
  }
};

const buildMetadataFacts = (
  streams: ReadonlyArray<Record<string, unknown>>,
  format: Record<string, unknown>
): InspiredesignMediaMetadataFacts => {
  const videoStream = streams.find((stream) => readString(stream.codec_type) === STREAM_TYPE_VIDEO);
  const audioStream = streams.find((stream) => readString(stream.codec_type) === STREAM_TYPE_AUDIO);
  return {
    dimensions: readDimensions(videoStream),
    durationSeconds: readNumber(videoStream?.duration) ?? readNumber(format.duration),
    fps: readFps(videoStream),
    frameCount: readFrameCount(videoStream),
    videoCodec: readString(videoStream?.codec_name),
    audioCodec: readString(audioStream?.codec_name),
    hasAudio: Boolean(audioStream),
    containerFormat: readString(format.format_name)
  };
};

const readDimensions = (stream?: Record<string, unknown>) => {
  const width = readNumber(stream?.width);
  const height = readNumber(stream?.height);
  if (!width || !height) {
    return undefined;
  }
  return { width, height, aspectRatio: roundRatio(width / height) };
};

const readFps = (stream?: Record<string, unknown>): number | undefined => {
  const averageRate = readString(stream?.avg_frame_rate) ?? readString(stream?.r_frame_rate);
  if (!averageRate) {
    return undefined;
  }
  const [numeratorText, denominatorText] = averageRate.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return undefined;
  }
  return roundRatio(numerator / denominator);
};

const readFrameCount = (stream?: Record<string, unknown>): number | undefined => {
  const frameCount = readNumber(stream?.nb_frames);
  return frameCount && frameCount > 0 ? Math.round(frameCount) : undefined;
};

const readRecords = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(asRecord) : [];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const readNumber = (value: unknown): number | undefined => {
  let parsed = Number.NaN;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    parsed = Number(value);
  }
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const roundRatio = (value: number): number => Math.round(value * 10_000) / 10_000;

const formatProcessError = (toolName: string, error: unknown): string => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return `${toolName} binary was not found.`;
  }
  return error instanceof Error ? `${toolName} failed: ${error.message}` : `${toolName} failed.`;
};
