import { spawn } from "child_process";
import {
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_HEIGHT,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_WIDTH,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES,
  INSPIREDESIGN_MEDIA_ANALYSIS_MIN_TEMPORAL_SAMPLE_DURATION_SECONDS,
  INSPIREDESIGN_MEDIA_ANALYSIS_PROCESS_TIMEOUT_MS,
  type InspiredesignMediaAdapterResult,
  type InspiredesignMediaAnalysisInput,
  type InspiredesignMediaMetadataFacts,
  type InspiredesignRgbFrame
} from "./types";

export type InspiredesignFfmpegFrameExtraction = {
  frames: InspiredesignRgbFrame[];
  outputWidth: number;
  outputHeight: number;
};

export type InspiredesignFfmpegRunOptions = {
  binaryPath?: string;
  timeoutMs?: number;
  maxFrames?: number;
  maxWidth?: number;
  maxHeight?: number;
  metadata?: InspiredesignMediaMetadataFacts;
};

export type InspiredesignFfmpegFrameRunner = (
  input: InspiredesignMediaAnalysisInput,
  options?: InspiredesignFfmpegRunOptions
) => Promise<InspiredesignMediaAdapterResult<InspiredesignFfmpegFrameExtraction>>;

type ProcessResult = {
  stdout: Buffer;
  exitCode: number | null;
  timedOut: boolean;
};

const DEFAULT_FFMPEG_BINARY = "ffmpeg";
const RGB_CHANNEL_COUNT = 3;
const IMAGE_FRAME_COUNT = 1;
const SCALE_FILTER_TEMPLATE = "scale=%WIDTH%:%HEIGHT%:force_original_aspect_ratio=decrease,pad=%WIDTH%:%HEIGHT%:(ow-iw)/2:(oh-ih)/2,format=rgb24";

export const extractInspiredesignFfmpegFrames: InspiredesignFfmpegFrameRunner = async (input, options = {}) => {
  const outputSize = calculateBoundedFrameSize(input, options.metadata, options);
  const maxFrames = resolveMaxFrames(input, options.maxFrames);
  const args = buildFfmpegArgs(input, outputSize.width, outputSize.height, maxFrames, options.metadata);

  try {
    const result = await runProcess(options.binaryPath ?? DEFAULT_FFMPEG_BINARY, args, options.timeoutMs);
    if (result.timedOut) {
      return { limitations: [`ffmpeg timed out after ${options.timeoutMs ?? INSPIREDESIGN_MEDIA_ANALYSIS_PROCESS_TIMEOUT_MS}ms.`] };
    }
    if (result.exitCode !== 0) {
      return { limitations: [`ffmpeg failed with exit code ${result.exitCode ?? "unknown"}.`] };
    }
    return parseRawFrames(result.stdout, outputSize.width, outputSize.height, maxFrames);
  } catch (error) {
    return { limitations: [formatProcessError("ffmpeg", error)] };
  }
};

export const calculateBoundedFrameSize = (
  input: Pick<InspiredesignMediaAnalysisInput, "width" | "height">,
  metadata?: InspiredesignMediaMetadataFacts,
  options: Pick<InspiredesignFfmpegRunOptions, "maxWidth" | "maxHeight"> = {}
): { width: number; height: number } => {
  const sourceWidth = metadata?.dimensions?.width ?? input.width ?? options.maxWidth ?? INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_WIDTH;
  const sourceHeight = metadata?.dimensions?.height ?? input.height ?? options.maxHeight ?? INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_HEIGHT;
  const maxWidth = options.maxWidth ?? INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_WIDTH;
  const maxHeight = options.maxHeight ?? INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_HEIGHT;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
};

const resolveMaxFrames = (input: Pick<InspiredesignMediaAnalysisInput, "kind">, requestedMaxFrames?: number): number => {
  const boundedFrames = Math.min(
    Math.max(IMAGE_FRAME_COUNT, requestedMaxFrames ?? INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES),
    INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES
  );
  return input.kind === "image" || input.kind === "video_poster" ? IMAGE_FRAME_COUNT : boundedFrames;
};

const buildFfmpegArgs = (
  input: InspiredesignMediaAnalysisInput,
  width: number,
  height: number,
  maxFrames: number,
  metadata?: InspiredesignMediaMetadataFacts
): string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-nostdin",
  "-i",
  input.filePath,
  "-vf",
  buildVideoFilter(input, width, height, maxFrames, metadata),
  "-frames:v",
  String(maxFrames),
  "-pix_fmt",
  "rgb24",
  "-f",
  "rawvideo",
  "pipe:1"
];

const buildVideoFilter = (
  input: Pick<InspiredesignMediaAnalysisInput, "kind">,
  width: number,
  height: number,
  maxFrames: number,
  metadata?: InspiredesignMediaMetadataFacts
): string => {
  const scaleFilter = SCALE_FILTER_TEMPLATE.replaceAll("%WIDTH%", String(width)).replaceAll("%HEIGHT%", String(height));
  const sampleFps = resolveTemporalSampleFps(input, maxFrames, metadata);
  return sampleFps ? `fps=${sampleFps},${scaleFilter}` : scaleFilter;
};

const resolveTemporalSampleFps = (
  input: Pick<InspiredesignMediaAnalysisInput, "kind">,
  maxFrames: number,
  metadata?: InspiredesignMediaMetadataFacts
): string | undefined => {
  if (input.kind !== "gif" && input.kind !== "video") return undefined;
  if (maxFrames <= IMAGE_FRAME_COUNT) return undefined;
  const durationSeconds = metadata?.durationSeconds;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  const sampledDurationSeconds = Math.max(durationSeconds, INSPIREDESIGN_MEDIA_ANALYSIS_MIN_TEMPORAL_SAMPLE_DURATION_SECONDS);
  const sampleFps = maxFrames / sampledDurationSeconds;
  return formatFps(sampleFps);
};

const formatFps = (value: number): string => {
  const rounded = Math.max(0.001, value);
  return rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
};

const runProcess = (binaryPath: string, args: string[], timeoutMs = INSPIREDESIGN_MEDIA_ANALYSIS_PROCESS_TIMEOUT_MS): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "ignore"] });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
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
    child.on("error", (error) => {
      settle(() => reject(error));
    });
    child.on("close", (exitCode) => {
      settle(() => {
        resolve({ stdout: Buffer.concat(stdoutChunks), exitCode, timedOut });
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

const parseRawFrames = (
  rawBytes: Buffer,
  width: number,
  height: number,
  maxFrames: number
): InspiredesignMediaAdapterResult<InspiredesignFfmpegFrameExtraction> => {
  const frameByteLength = width * height * RGB_CHANNEL_COUNT;
  const availableFrames = Math.min(Math.floor(rawBytes.length / frameByteLength), maxFrames);
  if (availableFrames <= 0) {
    return { limitations: ["ffmpeg produced no decodable RGB frames."] };
  }
  const frames = Array.from({ length: availableFrames }, (_, frameIndex) => {
    const start = frameIndex * frameByteLength;
    const frameData = rawBytes.subarray(start, start + frameByteLength);
    return { width, height, data: Uint8Array.from(frameData), frameIndex };
  });
  return { value: { frames, outputWidth: width, outputHeight: height }, limitations: [] };
};

const formatProcessError = (toolName: string, error: unknown): string => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return `${toolName} binary was not found.`;
  }
  return error instanceof Error ? `${toolName} failed: ${error.message}` : `${toolName} failed.`;
};
