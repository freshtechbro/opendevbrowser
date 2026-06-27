import { spawn } from "child_process";
import { resolve as resolvePath } from "path";
import {
  INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_BINARY_PROBE_OUTPUT_BYTES,
  OPENDEVBROWSER_FFMPEG_PATH_ENV,
  OPENDEVBROWSER_FFPROBE_PATH_ENV,
  type InspiredesignMediaAnalysisBinaryCapabilityTier,
  type InspiredesignMediaAnalysisBinaryPathsConfig,
  type InspiredesignMediaAnalysisBinaryResolution,
  type InspiredesignMediaAnalysisBinarySource,
  type InspiredesignMediaAnalysisBinaryStatus,
  type InspiredesignMediaAnalysisBinaryTool,
  type InspiredesignMediaAnalysisHostCapabilityTier
} from "./types";

export type InspiredesignMediaAnalysisBinaryResolverEnv = NodeJS.ProcessEnv;

export type InspiredesignMediaAnalysisBinaryResolverOptions = {
  config?: InspiredesignMediaAnalysisBinaryPathsConfig;
  env?: InspiredesignMediaAnalysisBinaryResolverEnv;
  timeoutMs?: number;
  commonPathDirs?: readonly string[];
};

type BinaryRequest = {
  tool: InspiredesignMediaAnalysisBinaryTool;
  envName: typeof OPENDEVBROWSER_FFMPEG_PATH_ENV | typeof OPENDEVBROWSER_FFPROBE_PATH_ENV;
  configPath?: string;
  pathDefault: string;
  availableTier: Exclude<InspiredesignMediaAnalysisBinaryCapabilityTier, "unavailable">;
};

type ProbeResult =
  | { version: string }
  | { limitation: string; enoent?: boolean };

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

type CommonPathFallbackContext = {
  request: BinaryRequest;
  selected: { source: InspiredesignMediaAnalysisBinarySource; requestedPath: string };
  env: InspiredesignMediaAnalysisBinaryResolverEnv;
  timeoutMs: number;
  commonPathDirs: readonly string[];
  originalProbe: ProbeResult;
};

const VERSION_LINE_LIMIT = 180;
const PROBE_ARGS = ["-version"] as const;
const MACOS_COMMON_PATH_DIRS = [
  "/opt/homebrew/bin",
  "/opt/local/bin",
  "/usr/local/bin",
  "/nix/var/nix/profiles/default/bin",
  "/usr/bin"
] as const;
const LINUX_COMMON_PATH_DIRS = ["/usr/local/bin", "/usr/bin"] as const;

export const resolveInspiredesignMediaAnalysisBinaries = async (
  options: InspiredesignMediaAnalysisBinaryResolverOptions = {}
): Promise<InspiredesignMediaAnalysisBinaryResolution> => {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS;
  const commonPathDirs = options.commonPathDirs ?? defaultCommonPathDirs(process.platform);
  const [ffmpeg, ffprobe] = await Promise.all([
    resolveBinaryStatus({
      tool: "ffmpeg",
      envName: OPENDEVBROWSER_FFMPEG_PATH_ENV,
      configPath: options.config?.ffmpegPath,
      pathDefault: "ffmpeg",
      availableTier: "frame_decode"
    }, env, timeoutMs, commonPathDirs),
    resolveBinaryStatus({
      tool: "ffprobe",
      envName: OPENDEVBROWSER_FFPROBE_PATH_ENV,
      configPath: options.config?.ffprobePath,
      pathDefault: "ffprobe",
      availableTier: "metadata_probe"
    }, env, timeoutMs, commonPathDirs)
  ]);
  const limitations = [ffmpeg.limitation, ffprobe.limitation]
    .filter((limitation): limitation is string => typeof limitation === "string");
  return {
    available: ffmpeg.available && ffprobe.available,
    capabilityTier: resolveHostCapabilityTier(ffmpeg, ffprobe),
    ffmpeg,
    ffprobe,
    limitations
  };
};

const resolveBinaryStatus = async (
  request: BinaryRequest,
  env: InspiredesignMediaAnalysisBinaryResolverEnv,
  timeoutMs: number,
  commonPathDirs: readonly string[]
): Promise<InspiredesignMediaAnalysisBinaryStatus> => {
  const selected = selectRequestedBinary(request, env);
  if (selected.requestedPath.trim().length === 0) {
    return unavailableStatus(request, selected, blankPathLimitation(request, selected.source));
  }
  const probe = await probeBinaryVersion(request.tool, selected.requestedPath, timeoutMs, env);
  if ("limitation" in probe) {
    const fallback = await tryCommonPathFallback({
      request,
      selected,
      env,
      timeoutMs,
      commonPathDirs,
      originalProbe: probe
    });
    return fallback ?? unavailableStatus(request, selected, probe.limitation);
  }
  return availableStatus(request, selected, selected.requestedPath, probe.version);
};

const selectRequestedBinary = (
  request: BinaryRequest,
  env: InspiredesignMediaAnalysisBinaryResolverEnv
): { source: InspiredesignMediaAnalysisBinarySource; requestedPath: string } => {
  const envPath = env[request.envName];
  if (typeof envPath === "string") {
    return { source: "env", requestedPath: envPath };
  }
  if (typeof request.configPath === "string") {
    return { source: "config", requestedPath: request.configPath };
  }
  return { source: "path", requestedPath: request.pathDefault };
};

const availableStatus = (
  request: BinaryRequest,
  selected: { source: InspiredesignMediaAnalysisBinarySource; requestedPath: string },
  resolvedPath: string,
  version: string
): InspiredesignMediaAnalysisBinaryStatus => ({
  tool: request.tool,
  available: true,
  source: selected.source,
  requestedPath: selected.requestedPath,
  resolvedPath,
  version,
  capabilityTier: request.availableTier
});

const unavailableStatus = (
  request: BinaryRequest,
  selected: { source: InspiredesignMediaAnalysisBinarySource; requestedPath: string },
  limitation: string
): InspiredesignMediaAnalysisBinaryStatus => ({
  tool: request.tool,
  available: false,
  source: selected.source,
  requestedPath: selected.requestedPath,
  limitation,
  capabilityTier: "unavailable"
});

const tryCommonPathFallback = async ({
  request,
  selected,
  env,
  timeoutMs,
  commonPathDirs,
  originalProbe
}: CommonPathFallbackContext): Promise<InspiredesignMediaAnalysisBinaryStatus | undefined> => {
  if (!("limitation" in originalProbe) || originalProbe.enoent !== true || selected.source !== "path") {
    return undefined;
  }
  for (const commonPathDir of commonPathDirs) {
    const trimmedDir = commonPathDir.trim();
    if (trimmedDir.length === 0) continue;
    const candidatePath = resolvePath(trimmedDir, request.tool);
    const probe = await probeBinaryVersion(request.tool, candidatePath, timeoutMs, env);
    if (!("limitation" in probe)) {
      return availableStatus(request, selected, candidatePath, probe.version);
    }
  }
  return undefined;
};

const defaultCommonPathDirs = (platform: NodeJS.Platform): readonly string[] => {
  if (platform === "darwin") return MACOS_COMMON_PATH_DIRS;
  if (platform === "linux") return LINUX_COMMON_PATH_DIRS;
  return [];
};

const blankPathLimitation = (
  request: BinaryRequest,
  source: InspiredesignMediaAnalysisBinarySource
): string => {
  if (source === "config") {
    return `${request.tool} config path is set but blank.`;
  }
  if (source === "env") {
    return `${request.envName} is set but blank.`;
  }
  return `${request.tool} PATH command is blank.`;
};

const resolveHostCapabilityTier = (
  ffmpeg: InspiredesignMediaAnalysisBinaryStatus,
  ffprobe: InspiredesignMediaAnalysisBinaryStatus
): InspiredesignMediaAnalysisHostCapabilityTier => {
  if (ffmpeg.available && ffprobe.available) return "full";
  if (ffprobe.available) return "metadata_only";
  if (ffmpeg.available) return "frame_decode_only";
  return "unavailable";
};

const probeBinaryVersion = async (
  tool: InspiredesignMediaAnalysisBinaryTool,
  binaryPath: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<ProbeResult> => {
  try {
    const result = await runVersionProcess(binaryPath, timeoutMs, env);
    if (result.timedOut) {
      return { limitation: `${tool} version probe timed out after ${timeoutMs}ms.` };
    }
    if (result.exitCode !== 0) {
      return { limitation: `${tool} version probe failed with exit code ${result.exitCode ?? "unknown"}.` };
    }
    return parseVersionOutput(tool, result.stdout, result.stderr);
  } catch (error) {
    return formatProbeError(tool, error);
  }
};

const runVersionProcess = (binaryPath: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [...PROBE_ARGS], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  const remainingBytes = INSPIREDESIGN_MEDIA_ANALYSIS_MAX_BINARY_PROBE_OUTPUT_BYTES - currentBytes;
  if (remainingBytes <= 0) return currentBytes;
  const safeChunk = chunk.length > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk;
  chunks.push(safeChunk);
  return currentBytes + safeChunk.length;
};

const parseVersionOutput = (
  tool: InspiredesignMediaAnalysisBinaryTool,
  stdout: string,
  stderr: string
): ProbeResult => {
  const versionLine = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!versionLine) {
    return { limitation: `${tool} version output was empty.` };
  }
  if (!new RegExp(`\\b${tool}\\b.*\\bversion\\b`, "iu").test(versionLine)) {
    return { limitation: `${tool} version output was not recognized.` };
  }
  return { version: versionLine.slice(0, VERSION_LINE_LIMIT) };
};

const formatProbeError = (tool: InspiredesignMediaAnalysisBinaryTool, error: unknown): ProbeResult => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return { limitation: `${tool} binary was not found.`, enoent: true };
  }
  const limitation = error instanceof Error
    ? `${tool} version probe failed: ${error.message}`
    : `${tool} version probe failed.`;
  return { limitation };
};
