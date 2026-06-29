import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildEmptyInspiredesignMediaDesignGuidance,
  buildInspiredesignMediaDesignGuidance,
  INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_BINARY_PROBE_OUTPUT_BYTES,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES,
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES,
  INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS,
  analyzeInspiredesignMediaArtifacts,
  analyzeInspiredesignRgbFrame,
  analyzeInspiredesignTypographyStructure,
  buildInspiredesignMotionFacts,
  calculateBoundedFrameSize,
  confidenceLabel,
  extractInspiredesignFfmpegFrames,
  runInspiredesignFfmpegSceneDetection,
  OPENDEVBROWSER_FFMPEG_PATH_ENV,
  OPENDEVBROWSER_FFPROBE_PATH_ENV,
  persistInspiredesignMediaAnalysis,
  resolveInspiredesignMediaAnalysisBinaries,
  runInspiredesignFfprobe,
  serializeInspiredesignMediaAnalysis,
  type InspiredesignFfmpegFrameRunner,
  type InspiredesignFfmpegSceneRunner,
  type InspiredesignFfprobeRunner,
  type InspiredesignMediaFacts,
  type InspiredesignMediaAnalysisInput,
  type InspiredesignRgbFrame
} from "../src/inspiredesign/media-analysis";

const RGB_CHANNEL_COUNT = 3;
const DARK_RGB = 8;
const LIGHT_RGB = 245;
const MID_RGB = 120;

const makeFrame = (width: number, height: number, fill: number, frameIndex = 0): InspiredesignRgbFrame => {
  const data = new Uint8Array(width * height * RGB_CHANNEL_COUNT);
  for (let offset = 0; offset < data.length; offset += RGB_CHANNEL_COUNT) {
    data[offset] = fill;
    data[offset + 1] = fill;
    data[offset + 2] = fill;
  }
  return { width, height, data, frameIndex };
};

const makeSparseFrameData = (length: number): Uint8Array => ({ length } as Uint8Array);

const drawRect = (
  frame: InspiredesignRgbFrame,
  rect: { x: number; y: number; width: number; height: number; value: number }
): void => {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * frame.width + x) * RGB_CHANNEL_COUNT;
      frame.data[offset] = rect.value;
      frame.data[offset + 1] = rect.value;
      frame.data[offset + 2] = rect.value;
    }
  }
};

const makeEditorialFrame = (): InspiredesignRgbFrame => {
  const frame = makeFrame(48, 64, DARK_RGB);
  drawRect(frame, { x: 4, y: 3, width: 28, height: 2, value: LIGHT_RGB });
  drawRect(frame, { x: 4, y: 14, width: 19, height: 9, value: LIGHT_RGB });
  drawRect(frame, { x: 4, y: 27, width: 15, height: 3, value: MID_RGB });
  drawRect(frame, { x: 4, y: 36, width: 10, height: 3, value: LIGHT_RGB });
  drawRect(frame, { x: 28, y: 8, width: 16, height: 25, value: MID_RGB });
  drawRect(frame, { x: 5, y: 50, width: 14, height: 3, value: LIGHT_RGB });
  drawRect(frame, { x: 27, y: 50, width: 14, height: 3, value: LIGHT_RGB });
  return frame;
};

const writeFakeNodeBinary = async (dir: string, binaryName: string, body: string): Promise<string> => {
  const binaryPath = join(dir, binaryName);
  await writeFile(binaryPath, `#!${process.execPath}\n${body}\n`);
  await chmod(binaryPath, 0o755);
  return binaryPath;
};

const makeFakeNodeBinary = async (body: string, binaryName = "fake-binary.cjs"): Promise<{ dir: string; binaryPath: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "odb-media-analysis-"));
  const binaryPath = await writeFakeNodeBinary(dir, binaryName, body);
  return { dir, binaryPath };
};

type FakeCommonBinaryOptions = {
  ffmpegBody?: string;
  ffprobeBody?: string;
};

const makeFakeCommonBinaryDir = async (
  options: FakeCommonBinaryOptions
): Promise<{ dir: string; ffmpegPath: string; ffprobePath: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "odb-media-analysis-common-path-"));
  const ffmpegPath = join(dir, "ffmpeg");
  const ffprobePath = join(dir, "ffprobe");
  if (typeof options.ffmpegBody === "string") {
    await writeFakeNodeBinary(dir, "ffmpeg", options.ffmpegBody);
  }
  if (typeof options.ffprobeBody === "string") {
    await writeFakeNodeBinary(dir, "ffprobe", options.ffprobeBody);
  }
  return { dir, ffmpegPath, ffprobePath };
};

const makeNonExecutableFile = async (body: string): Promise<{ dir: string; binaryPath: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "odb-media-analysis-non-exec-"));
  const binaryPath = join(dir, "fake-binary.cjs");
  await writeFile(binaryPath, body);
  return { dir, binaryPath };
};

const cleanupFakeBinary = async (dir: string): Promise<void> => {
  await rm(dir, { recursive: true, force: true });
};

const makeRawRgbBytes = (frames: readonly InspiredesignRgbFrame[]): number[] => [
  ...frames.flatMap((frame) => [...frame.data])
];

const trustedImageInput: InspiredesignMediaAnalysisInput = {
  referenceId: "pin-a",
  mediaPath: "pin-media-evidence/pin-a/main.jpg",
  filePath: "/tmp/main.jpg",
  sourceUrl: "https://www.pinterest.com/pin/123/",
  mediaUrl: "https://i.pinimg.com/example.jpg",
  kind: "image",
  contentType: "image/jpeg",
  bytes: 2048,
  hash: "a".repeat(64),
  width: 800,
  height: 1080,
  authority: "design_evidence",
  scheduledForBundle: true
};

describe("inspiredesign media-analysis runtime adapters", () => {
  it("resolves FFmpeg and FFprobe binaries from config and env without host dependencies", async () => {
    const configFfmpeg = await makeFakeNodeBinary("process.stdout.write('ffmpeg version config-1\\n');");
    const configFfprobe = await makeFakeNodeBinary("process.stdout.write('ffprobe version config-1\\n');");
    const envFfmpeg = await makeFakeNodeBinary("process.stdout.write('ffmpeg version env-1\\n');");
    const envFfprobe = await makeFakeNodeBinary("process.stdout.write('ffprobe version env-1\\n');");
    const env = {
      ...process.env,
      [OPENDEVBROWSER_FFMPEG_PATH_ENV]: envFfmpeg.binaryPath,
      [OPENDEVBROWSER_FFPROBE_PATH_ENV]: envFfprobe.binaryPath
    };

    try {
      const configResolved = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: configFfmpeg.binaryPath,
          ffprobePath: configFfprobe.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const envResolved = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: configFfmpeg.binaryPath,
          ffprobePath: configFfprobe.binaryPath
        },
        env,
        timeoutMs: 5000
      });

      expect(configResolved.available).toBe(true);
      expect(configResolved.capabilityTier).toBe("full");
      expect(configResolved.ffmpeg).toEqual(expect.objectContaining({
        available: true,
        source: "config",
        requestedPath: configFfmpeg.binaryPath,
        resolvedPath: configFfmpeg.binaryPath,
        version: "ffmpeg version config-1",
        capabilityTier: "frame_decode"
      }));
      expect(configResolved.ffprobe).toEqual(expect.objectContaining({
        available: true,
        source: "config",
        requestedPath: configFfprobe.binaryPath,
        resolvedPath: configFfprobe.binaryPath,
        version: "ffprobe version config-1",
        capabilityTier: "metadata_probe"
      }));
      expect(envResolved.ffmpeg).toEqual(expect.objectContaining({
        source: "env",
        requestedPath: envFfmpeg.binaryPath,
        version: "ffmpeg version env-1"
      }));
      expect(envResolved.ffprobe).toEqual(expect.objectContaining({
        source: "env",
        requestedPath: envFfprobe.binaryPath,
        version: "ffprobe version env-1"
      }));
    } finally {
      await Promise.all([
        cleanupFakeBinary(configFfmpeg.dir),
        cleanupFakeBinary(configFfprobe.dir),
        cleanupFakeBinary(envFfmpeg.dir),
        cleanupFakeBinary(envFfprobe.dir)
      ]);
    }
  });

  it("reports missing PATH and explicit override failures as non-fatal limitations", async () => {
    const configFfmpeg = await makeFakeNodeBinary("process.stdout.write('ffmpeg version config-1\\n');");
    const configFfprobe = await makeFakeNodeBinary("process.stdout.write('ffprobe version config-1\\n');");
    const emptyPathDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-empty-path-"));
    const badEnvPath = join(emptyPathDir, "missing-ffmpeg");

    try {
      const missingPath = await resolveInspiredesignMediaAnalysisBinaries({
        env: { PATH: emptyPathDir },
        timeoutMs: 100,
        commonPathDirs: []
      });
      const explicitEnvFailure = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: configFfmpeg.binaryPath,
          ffprobePath: configFfprobe.binaryPath
        },
        env: {
          ...process.env,
          [OPENDEVBROWSER_FFMPEG_PATH_ENV]: badEnvPath
        },
        timeoutMs: 5000
      });
      const blankEnvFailure = await resolveInspiredesignMediaAnalysisBinaries({
        env: {
          PATH: emptyPathDir,
          [OPENDEVBROWSER_FFMPEG_PATH_ENV]: "   "
        },
        timeoutMs: 10,
        commonPathDirs: []
      });
      const blankConfigFailure = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: configFfmpeg.binaryPath,
          ffprobePath: "   "
        },
        env: { ...process.env },
        timeoutMs: 5000
      });

      expect(missingPath.available).toBe(false);
      expect(missingPath.capabilityTier).toBe("unavailable");
      expect(missingPath.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "path",
        requestedPath: "ffmpeg",
        limitation: "ffmpeg binary was not found."
      }));
      expect(missingPath.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "path",
        requestedPath: "ffprobe",
        limitation: "ffprobe binary was not found."
      }));
      expect(explicitEnvFailure.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "env",
        requestedPath: badEnvPath,
        limitation: "ffmpeg binary was not found."
      }));
      expect(explicitEnvFailure.ffprobe).toEqual(expect.objectContaining({
        available: true,
        source: "config",
        requestedPath: configFfprobe.binaryPath
      }));
      expect(blankEnvFailure.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "env",
        requestedPath: "   ",
        limitation: `${OPENDEVBROWSER_FFMPEG_PATH_ENV} is set but blank.`
      }));
      expect(blankConfigFailure.available).toBe(false);
      expect(blankConfigFailure.capabilityTier).toBe("frame_decode_only");
      expect(blankConfigFailure.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        requestedPath: "   ",
        limitation: "ffprobe config path is set but blank."
      }));
    } finally {
      await Promise.all([
        cleanupFakeBinary(configFfmpeg.dir),
        cleanupFakeBinary(configFfprobe.dir),
        rm(emptyPathDir, { recursive: true, force: true })
      ]);
    }
  });

  it("falls back from implicit PATH ENOENT to common tool directories", async () => {
    const emptyPathDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-empty-path-"));
    const common = await makeFakeCommonBinaryDir({
      ffmpegBody: "process.stdout.write('ffmpeg version common-1\\n');",
      ffprobeBody: "process.stdout.write('ffprobe version common-1\\n');"
    });

    try {
      const resolved = await resolveInspiredesignMediaAnalysisBinaries({
        env: { PATH: emptyPathDir },
        timeoutMs: 5000,
        commonPathDirs: ["   ", common.dir]
      });

      expect(resolved.available).toBe(true);
      expect(resolved.capabilityTier).toBe("full");
      expect(resolved.limitations).toEqual([]);
      expect(resolved.ffmpeg).toEqual(expect.objectContaining({
        available: true,
        source: "path",
        requestedPath: "ffmpeg",
        resolvedPath: common.ffmpegPath,
        version: "ffmpeg version common-1",
        capabilityTier: "frame_decode"
      }));
      expect(resolved.ffprobe).toEqual(expect.objectContaining({
        available: true,
        source: "path",
        requestedPath: "ffprobe",
        resolvedPath: common.ffprobePath,
        version: "ffprobe version common-1",
        capabilityTier: "metadata_probe"
      }));
    } finally {
      await Promise.all([
        rm(emptyPathDir, { recursive: true, force: true }),
        cleanupFakeBinary(common.dir)
      ]);
    }
  });

  it("does not fall back for explicit env or config binary paths", async () => {
    const emptyPathDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-empty-path-"));
    const common = await makeFakeCommonBinaryDir({
      ffmpegBody: "process.stdout.write('ffmpeg version common-1\\n');",
      ffprobeBody: "process.stdout.write('ffprobe version common-1\\n');"
    });
    const missingFfmpeg = join(emptyPathDir, "missing-ffmpeg");
    const missingFfprobe = join(emptyPathDir, "missing-ffprobe");

    try {
      const explicitEnv = await resolveInspiredesignMediaAnalysisBinaries({
        env: {
          PATH: emptyPathDir,
          [OPENDEVBROWSER_FFMPEG_PATH_ENV]: missingFfmpeg,
          [OPENDEVBROWSER_FFPROBE_PATH_ENV]: missingFfprobe
        },
        timeoutMs: 5000,
        commonPathDirs: [common.dir]
      });
      const explicitConfig = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: missingFfmpeg,
          ffprobePath: missingFfprobe
        },
        env: { PATH: emptyPathDir },
        timeoutMs: 5000,
        commonPathDirs: [common.dir]
      });

      expect(explicitEnv.available).toBe(false);
      expect(explicitEnv.capabilityTier).toBe("unavailable");
      expect(explicitEnv.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "env",
        requestedPath: missingFfmpeg,
        limitation: "ffmpeg binary was not found."
      }));
      expect(explicitEnv.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "env",
        requestedPath: missingFfprobe,
        limitation: "ffprobe binary was not found."
      }));
      expect(explicitConfig.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        requestedPath: missingFfmpeg,
        limitation: "ffmpeg binary was not found."
      }));
      expect(explicitConfig.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        requestedPath: missingFfprobe,
        limitation: "ffprobe binary was not found."
      }));
    } finally {
      await Promise.all([
        rm(emptyPathDir, { recursive: true, force: true }),
        cleanupFakeBinary(common.dir)
      ]);
    }
  });

  it("keeps implicit PATH misses unavailable when common directories contain no candidates", async () => {
    const emptyPathDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-empty-path-"));
    const emptyCommonDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-common-empty-"));

    try {
      const resolved = await resolveInspiredesignMediaAnalysisBinaries({
        env: { PATH: emptyPathDir },
        timeoutMs: 100,
        commonPathDirs: [emptyCommonDir]
      });

      expect(resolved.available).toBe(false);
      expect(resolved.capabilityTier).toBe("unavailable");
      expect(resolved.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "path",
        requestedPath: "ffmpeg",
        limitation: "ffmpeg binary was not found."
      }));
      expect(resolved.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "path",
        requestedPath: "ffprobe",
        limitation: "ffprobe binary was not found."
      }));
    } finally {
      await Promise.all([
        rm(emptyPathDir, { recursive: true, force: true }),
        rm(emptyCommonDir, { recursive: true, force: true })
      ]);
    }
  });

  it("uses platform default common path directories for implicit PATH misses", async () => {
    const originalPlatform = process.platform;
    const setPlatform = (platform: NodeJS.Platform): void => {
      Object.defineProperty(process, "platform", { configurable: true, value: platform });
    };

    try {
      setPlatform("linux");
      const linuxResolved = await resolveInspiredesignMediaAnalysisBinaries({
        env: { PATH: "" },
        timeoutMs: 1
      });

      setPlatform("win32");
      const win32Resolved = await resolveInspiredesignMediaAnalysisBinaries({
        env: { PATH: "" },
        timeoutMs: 1
      });

      expect(linuxResolved.ffmpeg.source).toBeDefined();
      expect(win32Resolved.ffmpeg.source).toBe("path");
    } finally {
      setPlatform(originalPlatform);
    }
  });

  it("classifies partial capabilities from common directory fallback", async () => {
    const emptyPathDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-empty-path-"));
    const onlyFfmpeg = await makeFakeCommonBinaryDir({
      ffmpegBody: "process.stdout.write('ffmpeg version common-frame-only\\n');"
    });
    const onlyFfprobe = await makeFakeCommonBinaryDir({
      ffprobeBody: "process.stdout.write('ffprobe version common-metadata-only\\n');"
    });

    try {
      const frameDecodeOnly = await resolveInspiredesignMediaAnalysisBinaries({
        env: { PATH: emptyPathDir },
        timeoutMs: 5000,
        commonPathDirs: [onlyFfmpeg.dir]
      });
      const metadataOnly = await resolveInspiredesignMediaAnalysisBinaries({
        env: { PATH: emptyPathDir },
        timeoutMs: 5000,
        commonPathDirs: [onlyFfprobe.dir]
      });

      expect(frameDecodeOnly.available).toBe(false);
      expect(frameDecodeOnly.capabilityTier).toBe("frame_decode_only");
      expect(frameDecodeOnly.ffmpeg).toEqual(expect.objectContaining({
        available: true,
        source: "path",
        requestedPath: "ffmpeg",
        resolvedPath: onlyFfmpeg.ffmpegPath,
        version: "ffmpeg version common-frame-only"
      }));
      expect(frameDecodeOnly.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "path",
        requestedPath: "ffprobe",
        limitation: "ffprobe binary was not found."
      }));
      expect(metadataOnly.available).toBe(false);
      expect(metadataOnly.capabilityTier).toBe("metadata_only");
      expect(metadataOnly.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "path",
        requestedPath: "ffmpeg",
        limitation: "ffmpeg binary was not found."
      }));
      expect(metadataOnly.ffprobe).toEqual(expect.objectContaining({
        available: true,
        source: "path",
        requestedPath: "ffprobe",
        resolvedPath: onlyFfprobe.ffprobePath,
        version: "ffprobe version common-metadata-only"
      }));
    } finally {
      await Promise.all([
        rm(emptyPathDir, { recursive: true, force: true }),
        cleanupFakeBinary(onlyFfmpeg.dir),
        cleanupFakeBinary(onlyFfprobe.dir)
      ]);
    }
  });

  it("reports version probe edge cases without using host binaries", async () => {
    const failed = await makeFakeNodeBinary("process.stderr.write('bad binary'); process.exitCode = 7;");
    const timedOut = await makeFakeNodeBinary("setTimeout(() => undefined, 1000);");
    const empty = await makeFakeNodeBinary("process.exitCode = 0;");
    const unrecognized = await makeFakeNodeBinary("process.stdout.write('tool build details\\n');");
    const truncated = await makeFakeNodeBinary(`
const first = 'ffprobe version ' + 'x'.repeat(${INSPIREDESIGN_MEDIA_ANALYSIS_MAX_BINARY_PROBE_OUTPUT_BYTES});
process.stdout.write(first);
setImmediate(() => process.stdout.write('tail'));
`);

    try {
      const failedProbe = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: failed.binaryPath,
          ffprobePath: empty.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const timedOutProbe = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: timedOut.binaryPath,
          ffprobePath: timedOut.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 250
      });
      const unrecognizedProbe = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: unrecognized.binaryPath,
          ffprobePath: truncated.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });

      expect(failedProbe.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        limitation: "ffmpeg version probe failed with exit code 7."
      }));
      expect(failedProbe.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        limitation: "ffprobe version output was empty."
      }));
      expect(timedOutProbe.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        limitation: "ffmpeg version probe timed out after 250ms."
      }));
      expect(timedOutProbe.ffprobe).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        limitation: "ffprobe version probe timed out after 250ms."
      }));
      expect(unrecognizedProbe.ffmpeg).toEqual(expect.objectContaining({
        available: false,
        source: "config",
        limitation: "ffmpeg version output was not recognized."
      }));
      expect(unrecognizedProbe.ffprobe).toEqual(expect.objectContaining({
        available: true,
        version: expect.stringMatching(/^ffprobe version x+/u)
      }));
      expect(unrecognizedProbe.ffprobe.version?.length).toBe(180);
      expect(unrecognizedProbe.capabilityTier).toBe("metadata_only");
    } finally {
      await Promise.all([
        cleanupFakeBinary(failed.dir),
        cleanupFakeBinary(timedOut.dir),
        cleanupFakeBinary(empty.dir),
        cleanupFakeBinary(unrecognized.dir),
        cleanupFakeBinary(truncated.dir)
      ]);
    }
  });

  it("classifies partial capabilities and version-probe edge failures", async () => {
    const okFfmpeg = await makeFakeNodeBinary("process.stderr.write('ffmpeg version stderr-1\\n');");
    const okFfprobe = await makeFakeNodeBinary("process.stderr.write('ffprobe version stderr-1\\n');");
    const emptyOutput = await makeFakeNodeBinary("");
    const unrecognizedOutput = await makeFakeNodeBinary("process.stdout.write('hello from a helper\\n');");
    const failedExit = await makeFakeNodeBinary("process.exitCode = 7;");
    const signalExit = await makeFakeNodeBinary("process.kill(process.pid, 'SIGTERM');");
    const boundedOutput = await makeFakeNodeBinary(
      `process.stdout.write(Buffer.alloc(${INSPIREDESIGN_MEDIA_ANALYSIS_MAX_BINARY_PROBE_OUTPUT_BYTES + 1}, 65)); process.stdout.write(Buffer.alloc(64, 66));`
    );
    const nonExecutable = await makeNonExecutableFile("#!/usr/bin/env node\nprocess.stdout.write('ffmpeg version never-runs\\n');");
    const missingFfmpeg = join(nonExecutable.dir, "missing-ffmpeg");
    const missingFfprobe = join(nonExecutable.dir, "missing-ffprobe");

    try {
      const fullFromStderr = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: okFfmpeg.binaryPath,
          ffprobePath: okFfprobe.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const frameDecodeOnly = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: okFfmpeg.binaryPath,
          ffprobePath: missingFfprobe
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const metadataOnly = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: missingFfmpeg,
          ffprobePath: okFfprobe.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const exitFailures = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: failedExit.binaryPath,
          ffprobePath: signalExit.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const parseFailures = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: emptyOutput.binaryPath,
          ffprobePath: unrecognizedOutput.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const spawnFailure = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: nonExecutable.binaryPath,
          ffprobePath: okFfprobe.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });
      const outputLimited = await resolveInspiredesignMediaAnalysisBinaries({
        config: {
          ffmpegPath: boundedOutput.binaryPath,
          ffprobePath: okFfprobe.binaryPath
        },
        env: { ...process.env },
        timeoutMs: 5000
      });

      expect(fullFromStderr.available).toBe(true);
      expect(fullFromStderr.ffmpeg.version).toBe("ffmpeg version stderr-1");
      expect(fullFromStderr.ffprobe.version).toBe("ffprobe version stderr-1");
      expect(frameDecodeOnly.available).toBe(false);
      expect(frameDecodeOnly.capabilityTier).toBe("frame_decode_only");
      expect(frameDecodeOnly.ffprobe.limitation).toBe("ffprobe binary was not found.");
      expect(metadataOnly.available).toBe(false);
      expect(metadataOnly.capabilityTier).toBe("metadata_only");
      expect(metadataOnly.ffmpeg.limitation).toBe("ffmpeg binary was not found.");
      expect(exitFailures.ffmpeg.limitation).toBe("ffmpeg version probe failed with exit code 7.");
      expect(exitFailures.ffprobe.limitation).toBe("ffprobe version probe failed with exit code unknown.");
      expect(parseFailures.ffmpeg.limitation).toBe("ffmpeg version output was empty.");
      expect(parseFailures.ffprobe.limitation).toBe("ffprobe version output was not recognized.");
      expect(spawnFailure.ffmpeg.limitation).toContain("ffmpeg version probe failed:");
      expect(outputLimited.ffmpeg.limitation).toBe("ffmpeg version output was not recognized.");
    } finally {
      await Promise.all([
        cleanupFakeBinary(okFfmpeg.dir),
        cleanupFakeBinary(okFfprobe.dir),
        cleanupFakeBinary(emptyOutput.dir),
        cleanupFakeBinary(unrecognizedOutput.dir),
        cleanupFakeBinary(failedExit.dir),
        cleanupFakeBinary(signalExit.dir),
        cleanupFakeBinary(boundedOutput.dir),
        cleanupFakeBinary(nonExecutable.dir)
      ]);
    }
  });

  it("parses FFprobe metadata, fallbacks, and process failures without inventing facts", async () => {
    const fullMetadata = {
      streams: [
        {
          codec_type: "video",
          width: "640",
          height: 320,
          duration: "2.5",
          avg_frame_rate: "60000/1001",
          nb_frames: "7.2",
          codec_name: "h264"
        },
        { codec_type: "audio", codec_name: "aac" }
      ],
      format: { format_name: "mov,mp4,m4a" }
    };
    const formatDurationOnly = {
      streams: [{ codec_type: "video", width: 0, height: "invalid", r_frame_rate: "25/0", nb_frames: "0" }],
      format: { duration: "3.75", format_name: "" }
    };
    const emptyRoot = [] as unknown[];
    const binaries = [
      await makeFakeNodeBinary(`process.stdout.write(${JSON.stringify(JSON.stringify(fullMetadata))});`),
      await makeFakeNodeBinary(`process.stdout.write(${JSON.stringify(JSON.stringify(formatDurationOnly))});`),
      await makeFakeNodeBinary(`process.stdout.write(${JSON.stringify(JSON.stringify(emptyRoot))});`),
      await makeFakeNodeBinary("process.stdout.write('{not json');"),
      await makeFakeNodeBinary("process.stderr.write('ffprobe failed'); process.exitCode = 7;"),
      await makeFakeNodeBinary("setTimeout(() => undefined, 1000);")
    ];

    try {
      const parsed = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binaries[0].binaryPath });
      const fallback = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binaries[1].binaryPath });
      const empty = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binaries[2].binaryPath });
      const invalid = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binaries[3].binaryPath });
      const failed = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binaries[4].binaryPath });
      const timedOut = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binaries[5].binaryPath, timeoutMs: 10 });

      expect(parsed.value?.dimensions).toEqual({ width: 640, height: 320, aspectRatio: 2 });
      expect(parsed.value?.durationSeconds).toBe(2.5);
      expect(parsed.value?.fps).toBe(59.9401);
      expect(parsed.value?.frameCount).toBe(7);
      expect(parsed.value?.audioCodec).toBe("aac");
      expect(parsed.value?.hasAudio).toBe(true);
      expect(fallback.value?.dimensions).toBeUndefined();
      expect(fallback.value?.durationSeconds).toBe(3.75);
      expect(fallback.value?.fps).toBeUndefined();
      expect(fallback.value?.frameCount).toBeUndefined();
      expect(fallback.value?.hasAudio).toBe(false);
      expect(empty.value?.containerFormat).toBeUndefined();
      expect(invalid.limitations[0]).toContain("ffprobe JSON could not be parsed");
      expect(failed.limitations[0]).toBe("ffprobe failed with exit code 7.");
      expect(timedOut.limitations[0]).toBe("ffprobe timed out after 10ms.");
    } finally {
      await Promise.all(binaries.map((binary) => cleanupFakeBinary(binary.dir)));
    }
  });

  it("covers FFprobe edge metadata branches without inventing facts", async () => {
    const rFrameRateOnly = {
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          duration: "",
          avg_frame_rate: "",
          r_frame_rate: "30000/1001",
          nb_frames: "-4",
          codec_name: ""
        }
      ],
      format: { duration: "5.25", format_name: "mp4" }
    };
    const signalExitBinary = await makeFakeNodeBinary("process.kill(process.pid, 'SIGTERM');");
    const rFrameRateBinary = await makeFakeNodeBinary(`process.stdout.write(${JSON.stringify(JSON.stringify(rFrameRateOnly))});`);

    try {
      const parsed = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: rFrameRateBinary.binaryPath });
      const signalExit = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: signalExitBinary.binaryPath });

      expect(parsed.value).toEqual(expect.objectContaining({
        dimensions: { width: 1920, height: 1080, aspectRatio: 1.7778 },
        durationSeconds: 5.25,
        fps: 29.97,
        frameCount: undefined,
        videoCodec: undefined,
        hasAudio: false,
        containerFormat: "mp4"
      }));
      expect(signalExit.limitations[0]).toBe("ffprobe failed with exit code unknown.");
    } finally {
      await Promise.all([
        cleanupFakeBinary(signalExitBinary.dir),
        cleanupFakeBinary(rFrameRateBinary.dir)
      ]);
    }
  });

  it("bounds FFprobe output collection before parsing", async () => {
    const binary = await makeFakeNodeBinary(
      `process.stdout.write(Buffer.alloc(${INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES}, 65)); process.stdout.write(Buffer.alloc(64, 66));`
    );

    try {
      const result = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binary.binaryPath });

      expect(result.limitations[0]).toContain("ffprobe JSON could not be parsed");
    } finally {
      await cleanupFakeBinary(binary.dir);
    }
  });

  it("extracts FFmpeg frames with bounded sizing and reports adapter failures", async () => {
    const firstFrame = makeFrame(2, 1, DARK_RGB, 0);
    const secondFrame = makeFrame(2, 1, LIGHT_RGB, 1);
    const rawBytes = makeRawRgbBytes([firstFrame, secondFrame]);
    const frameBinary = await makeFakeNodeBinary(`process.stdout.write(Buffer.from(${JSON.stringify(rawBytes)}));`);
    const emptyBinary = await makeFakeNodeBinary("");
    const failedBinary = await makeFakeNodeBinary("process.exitCode = 9;");
    const timeoutBinary = await makeFakeNodeBinary("setTimeout(() => undefined, 1000);");
    const boundedBinary = await makeFakeNodeBinary(
      `process.stdout.write(Buffer.alloc(${INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES}, 12)); process.stdout.write(Buffer.alloc(64, 13));`
    );

    try {
      const metadataSized = calculateBoundedFrameSize({ width: 20, height: 10 }, {
        dimensions: { width: 640, height: 320, aspectRatio: 2 }
      }, { maxWidth: 160, maxHeight: 80 });
      const optionSized = calculateBoundedFrameSize({}, undefined, { maxWidth: 80, maxHeight: 40 });
      const defaultSized = calculateBoundedFrameSize({});
      const imageFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, width: 2, height: 1 },
        { binaryPath: frameBinary.binaryPath, maxWidth: 2, maxHeight: 1, maxFrames: 5 }
      );
      const videoFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, kind: "video", contentType: "video/mp4", width: 2, height: 1 },
        { binaryPath: frameBinary.binaryPath, maxWidth: 2, maxHeight: 1, maxFrames: 2 }
      );
      const noFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, width: 2, height: 1 },
        { binaryPath: emptyBinary.binaryPath, maxWidth: 2, maxHeight: 1 }
      );
      const failed = await extractInspiredesignFfmpegFrames(trustedImageInput, { binaryPath: failedBinary.binaryPath });
      const timedOut = await extractInspiredesignFfmpegFrames(trustedImageInput, { binaryPath: timeoutBinary.binaryPath, timeoutMs: 10 });
      const bounded = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, width: 1, height: 1 },
        { binaryPath: boundedBinary.binaryPath, maxWidth: 1, maxHeight: 1, maxFrames: 1 }
      );

      expect(metadataSized).toEqual({ width: 160, height: 80 });
      expect(optionSized).toEqual({ width: 80, height: 40 });
      expect(defaultSized).toEqual({ width: 160, height: 160 });
      expect(imageFrames.value?.frames).toHaveLength(1);
      expect(videoFrames.value?.frames).toHaveLength(2);
      expect(noFrames.limitations[0]).toBe("ffmpeg produced no decodable RGB frames.");
      expect(failed.limitations[0]).toBe("ffmpeg failed with exit code 9.");
      expect(timedOut.limitations[0]).toBe("ffmpeg timed out after 10ms.");
      expect(bounded.value?.frames).toHaveLength(1);
    } finally {
      await Promise.all([
        cleanupFakeBinary(frameBinary.dir),
        cleanupFakeBinary(emptyBinary.dir),
        cleanupFakeBinary(failedBinary.dir),
        cleanupFakeBinary(timeoutBinary.dir),
        cleanupFakeBinary(boundedBinary.dir)
      ]);
    }
  });

  it("bounds FFmpeg frame sizing and sample counts across input classes", async () => {
    const frames = Array.from({ length: INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES + 2 }, (_, frameIndex) => (
      makeFrame(1, 1, frameIndex % 2 === 0 ? DARK_RGB : LIGHT_RGB, frameIndex)
    ));
    const frameBinary = await makeFakeNodeBinary(`process.stdout.write(Buffer.from(${JSON.stringify(makeRawRgbBytes(frames))}));`);
    const signalExitBinary = await makeFakeNodeBinary("process.kill(process.pid, 'SIGTERM');");

    try {
      const inputSized = calculateBoundedFrameSize({ width: 320, height: 180 }, undefined, { maxWidth: 160, maxHeight: 160 });
      const tallSized = calculateBoundedFrameSize({ width: 180, height: 360 }, undefined, { maxWidth: 160, maxHeight: 160 });
      const posterFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, kind: "video_poster", width: 1, height: 1 },
        { binaryPath: frameBinary.binaryPath, maxWidth: 1, maxHeight: 1, maxFrames: 99 }
      );
      const clampedLowFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, kind: "video", contentType: "video/mp4", width: 1, height: 1 },
        { binaryPath: frameBinary.binaryPath, maxWidth: 1, maxHeight: 1, maxFrames: 0 }
      );
      const clampedHighFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, kind: "gif", contentType: "image/gif", width: 1, height: 1 },
        { binaryPath: frameBinary.binaryPath, maxWidth: 1, maxHeight: 1, maxFrames: 99 }
      );
      const signalExit = await extractInspiredesignFfmpegFrames(trustedImageInput, {
        binaryPath: signalExitBinary.binaryPath,
        maxWidth: 1,
        maxHeight: 1
      });

      expect(inputSized).toEqual({ width: 160, height: 90 });
      expect(tallSized).toEqual({ width: 80, height: 160 });
      expect(posterFrames.value?.frames).toHaveLength(1);
      expect(clampedLowFrames.value?.frames).toHaveLength(1);
      expect(clampedHighFrames.value?.frames).toHaveLength(INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES);
      expect(signalExit.limitations[0]).toBe("ffmpeg failed with exit code unknown.");
    } finally {
      await Promise.all([
        cleanupFakeBinary(frameBinary.dir),
        cleanupFakeBinary(signalExitBinary.dir)
      ]);
    }
  });

  it("uses duration metadata to distribute animated media samples over time", async () => {
    const argsPath = join(await mkdtemp(join(tmpdir(), "odb-media-analysis-args-")), "args.json");
    const rawBytes = makeRawRgbBytes(Array.from({ length: 4 }, (_, frameIndex) => makeFrame(1, 1, frameIndex % 2 === 0 ? DARK_RGB : LIGHT_RGB, frameIndex)));
    const frameBinary = await makeFakeNodeBinary(
      `require('fs').writeFileSync(process.env.ODB_FFMPEG_ARGS_OUT, JSON.stringify(process.argv.slice(2))); process.stdout.write(Buffer.from(${JSON.stringify(rawBytes)}));`
    );
    const originalArgsOut = process.env.ODB_FFMPEG_ARGS_OUT;
    process.env.ODB_FFMPEG_ARGS_OUT = argsPath;

    try {
      const result = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, kind: "video", contentType: "video/mp4", width: 1, height: 1 },
        {
          binaryPath: frameBinary.binaryPath,
          maxWidth: 1,
          maxHeight: 1,
          maxFrames: 4,
          metadata: {
            durationSeconds: 16,
            dimensions: { width: 1, height: 1, aspectRatio: 1 }
          }
        }
      );
      const args = JSON.parse(await readFile(argsPath, "utf8")) as string[];
      const videoFilter = args[args.indexOf("-vf") + 1];

      expect(result.value?.frames).toHaveLength(4);
      expect(videoFilter).toBe("fps=0.25,scale=1:1:force_original_aspect_ratio=decrease,pad=1:1:(ow-iw)/2:(oh-ih)/2,format=rgb24");
      expect(args).toContain("-frames:v");
      expect(args[args.indexOf("-frames:v") + 1]).toBe("4");
    } finally {
      if (originalArgsOut === undefined) {
        delete process.env.ODB_FFMPEG_ARGS_OUT;
      } else {
        process.env.ODB_FFMPEG_ARGS_OUT = originalArgsOut;
      }
      await Promise.all([
        cleanupFakeBinary(frameBinary.dir),
        rm(dirname(argsPath), { recursive: true, force: true })
      ]);
    }
  });

  it("keeps adapter output collection bounded across partial and oversized chunks", async () => {
    const ffprobeBinary = await makeFakeNodeBinary(
      `process.stdout.write(Buffer.alloc(${INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES - 2}, 65)); process.stdout.write(Buffer.alloc(8, 66));`
    );
    const ffmpegBinary = await makeFakeNodeBinary(
      `process.stdout.write(Buffer.from([${DARK_RGB}, ${DARK_RGB}, ${DARK_RGB}])); process.stdout.write(Buffer.alloc(${INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES}, 12));`
    );

    try {
      const ffprobeResult = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: ffprobeBinary.binaryPath });
      const ffmpegResult = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, width: 1, height: 1 },
        { binaryPath: ffmpegBinary.binaryPath, maxWidth: 1, maxHeight: 1, maxFrames: 1 }
      );

      expect(ffprobeResult.limitations[0]).toContain("ffprobe JSON could not be parsed");
      expect(ffmpegResult.value?.frames[0]?.data).toEqual(new Uint8Array([DARK_RGB, DARK_RGB, DARK_RGB]));
    } finally {
      await Promise.all([
        cleanupFakeBinary(ffprobeBinary.dir),
        cleanupFakeBinary(ffmpegBinary.dir)
      ]);
    }
  });

  it("uses PATH FFmpeg and FFprobe defaults when adapter binary paths are omitted", async () => {
    const binaryDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-path-"));
    const metadata = {
      streams: [{
        codec_type: "video",
        width: 1,
        height: 1,
        avg_frame_rate: "24/1",
        nb_frames: "12",
        codec_name: "h264"
      }],
      format: { duration: "0.5", format_name: "mov,mp4" }
    };
    await writeFakeNodeBinary(
      binaryDir,
      "ffmpeg",
      `process.stdout.write(Buffer.from([${DARK_RGB}, ${DARK_RGB}, ${DARK_RGB}]));`
    );
    await writeFakeNodeBinary(
      binaryDir,
      "ffprobe",
      `process.stdout.write(${JSON.stringify(JSON.stringify(metadata))});`
    );
    const originalPath = process.env.PATH;
    process.env.PATH = originalPath ? `${binaryDir}${delimiter}${originalPath}` : binaryDir;

    try {
      const ffprobeResult = await runInspiredesignFfprobe(trustedImageInput.filePath);
      const ffmpegResult = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, width: 1, height: 1 },
        { maxWidth: 1, maxHeight: 1, maxFrames: 1 }
      );

      expect(ffprobeResult.value).toEqual(expect.objectContaining({
        dimensions: { width: 1, height: 1, aspectRatio: 1 },
        fps: 24,
        frameCount: 12,
        videoCodec: "h264",
        containerFormat: "mov,mp4"
      }));
      expect(ffmpegResult.value?.frames[0]?.data).toEqual(new Uint8Array([DARK_RGB, DARK_RGB, DARK_RGB]));
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      await rm(binaryDir, { recursive: true, force: true });
    }
  });
});

describe("inspiredesign media-analysis pure analyzers", () => {
  it("extracts deterministic tone, palette, layout, and OCR-free typography structure from RGB pixels", () => {
    const frame = makeEditorialFrame();
    const pixelFacts = analyzeInspiredesignRgbFrame(frame);
    const typography = analyzeInspiredesignTypographyStructure(frame);

    expect(pixelFacts.tone.darkCoverage).toBeGreaterThan(0.5);
    expect(pixelFacts.tone.contrastPosture).toBe("high");
    expect(pixelFacts.palette.map((swatch) => swatch.hex)).toContain("#202020");
    expect(pixelFacts.layout.zones.length).toBeGreaterThan(0);
    expect(pixelFacts.layout.composition).toMatch(/hero|poster|grid/);
    expect(typography.readableTextAvailable).toBe(false);
    expect(typography.regions.some((region) => region.role === "hero_headline_candidate")).toBe(true);
    expect(typography.textRegionLayout.summary).toContain("Exact readable text was not extracted");
  });

  it("computes sampled motion facts from bounded RGB frames", () => {
    const darkFrame = makeFrame(4, 4, DARK_RGB, 0);
    const lightFrame = makeFrame(4, 4, LIGHT_RGB, 1);
    const motion = buildInspiredesignMotionFacts([darkFrame, lightFrame], 20);

    expect(motion.sampledFrameCount).toBe(2);
    expect(motion.frameDeltas[0]).toBeGreaterThan(0.2);
    expect(motion.posture).toBe("dynamic_motion");
    expect(motion.cadence).toBe("fast");
  });

  it("classifies low-information and varied pixel compositions without unsafe defaults", () => {
    const emptyFrame = makeFrame(0, 0, DARK_RGB);
    const truncatedFrame: InspiredesignRgbFrame = { width: 1, height: 1, data: new Uint8Array([LIGHT_RGB]), frameIndex: 0 };
    const landscape = makeFrame(12, 6, MID_RGB);
    const portrait = makeFrame(6, 12, MID_RGB);
    const leftSplit = makeFrame(9, 9, MID_RGB);
    const rightSplit = makeFrame(9, 9, MID_RGB);
    const lowerGrid = makeFrame(9, 9, MID_RGB);
    const denseGrid = makeFrame(9, 9, MID_RGB);
    const paletteFrame = makeFrame(4, 1, DARK_RGB);
    const activeLayoutRgb = 155;

    drawRect(leftSplit, { x: 0, y: 0, width: 3, height: 9, value: activeLayoutRgb });
    drawRect(rightSplit, { x: 6, y: 0, width: 3, height: 9, value: activeLayoutRgb });
    drawRect(lowerGrid, { x: 0, y: 6, width: 6, height: 3, value: activeLayoutRgb });
    drawRect(denseGrid, { x: 0, y: 0, width: 3, height: 3, value: activeLayoutRgb });
    drawRect(denseGrid, { x: 3, y: 0, width: 3, height: 3, value: activeLayoutRgb });
    drawRect(denseGrid, { x: 6, y: 0, width: 3, height: 3, value: activeLayoutRgb });
    drawRect(denseGrid, { x: 6, y: 3, width: 3, height: 3, value: activeLayoutRgb });
    paletteFrame.data.set([LIGHT_RGB, LIGHT_RGB, LIGHT_RGB], 3);
    paletteFrame.data.set([MID_RGB, MID_RGB, MID_RGB], 6);
    paletteFrame.data.set([210, 80, 40], 9);

    expect(analyzeInspiredesignRgbFrame(emptyFrame).layout.composition).toBe("balanced poster composition");
    expect(analyzeInspiredesignRgbFrame(truncatedFrame).palette[0]?.hex).toBe("#E02020");
    expect(analyzeInspiredesignRgbFrame(landscape).layout.composition).toBe("centered editorial composition");
    expect(analyzeInspiredesignRgbFrame(portrait).layout.composition).toBe("balanced poster composition");
    expect(analyzeInspiredesignRgbFrame(leftSplit).layout.composition).toBe("left-weighted split hero");
    expect(analyzeInspiredesignRgbFrame(rightSplit).layout.composition).toBe("right-weighted split hero");
    expect(analyzeInspiredesignRgbFrame(lowerGrid).layout.composition).toBe("upper hero with lower grid");
    expect(analyzeInspiredesignRgbFrame(denseGrid).layout.composition).toBe("dense grid composition");
    expect(analyzeInspiredesignRgbFrame(paletteFrame).palette.map((swatch) => swatch.roleHint)).toEqual([
      "background",
      "foreground",
      "muted foreground",
      "accent"
    ]);
  });

  it("classifies muted typography, balanced edges, and malformed motion frame channels", () => {
    const mutedTextFrame = makeFrame(100, 100, MID_RGB);
    const balancedEdges = makeFrame(6, 6, MID_RGB);
    const denseEdges = makeFrame(6, 6, DARK_RGB);
    const moderateContrast = makeFrame(4, 1, 100);
    const brightSurfacePalette = makeFrame(2, 1, LIGHT_RGB);
    const malformedPrevious: InspiredesignRgbFrame = { width: 1, height: 1, data: new Uint8Array([8]), frameIndex: 0 };
    const malformedCurrent: InspiredesignRgbFrame = { width: 1, height: 1, data: new Uint8Array([16]), frameIndex: 1 };

    [
      { x: 40, y: 4, width: 18, height: 3 },
      { x: 40, y: 15, width: 18, height: 5 },
      { x: 40, y: 26, width: 18, height: 5 },
      { x: 40, y: 37, width: 18, height: 5 },
      { x: 40, y: 48, width: 18, height: 5 },
      { x: 40, y: 67, width: 18, height: 5 },
      { x: 40, y: 78, width: 18, height: 5 }
    ].forEach((rect) => drawRect(mutedTextFrame, { ...rect, value: 40 }));

    drawRect(balancedEdges, { x: 0, y: 0, width: 3, height: 6, value: LIGHT_RGB });
    for (let y = 0; y < denseEdges.height; y += 1) {
      for (let x = 0; x < denseEdges.width; x += 1) {
        if ((x + y) % 2 === 0) {
          drawRect(denseEdges, { x, y, width: 1, height: 1, value: LIGHT_RGB });
        }
      }
    }
    moderateContrast.data.set([150, 150, 150], 3);
    moderateContrast.data.set([160, 160, 160], 6);
    moderateContrast.data.set([200, 200, 200], 9);
    brightSurfacePalette.data.set([190, 190, 190], 3);

    const typography = analyzeInspiredesignTypographyStructure(mutedTextFrame);
    const balancedTone = analyzeInspiredesignRgbFrame(balancedEdges).tone;
    const denseTone = analyzeInspiredesignRgbFrame(denseEdges).tone;
    const moderateTone = analyzeInspiredesignRgbFrame(moderateContrast).tone;
    const paletteHints = analyzeInspiredesignRgbFrame(brightSurfacePalette).palette.map((swatch) => swatch.roleHint);
    const malformedMotion = buildInspiredesignMotionFacts([malformedPrevious, malformedCurrent], 24);
    const slowMotion = buildInspiredesignMotionFacts([makeFrame(1, 1, DARK_RGB, 0), makeFrame(1, 1, 18, 1)], 24);
    const moderateMotion = buildInspiredesignMotionFacts([makeFrame(1, 1, DARK_RGB, 0), makeFrame(1, 1, 45, 1)], 24);

    expect(typography.posture).toContain("dense, muted-contrast, center-weighted");
    expect(typography.regions.every((region) => region.contrast === "muted")).toBe(true);
    expect(typography.regions.every((region) => region.alignment === "center")).toBe(true);
    expect(balancedTone.densityPosture).toBe("balanced");
    expect(denseTone.densityPosture).toBe("dense");
    expect(moderateTone.contrastPosture).toBe("moderate");
    expect(paletteHints[0]).toBe("surface");
    expect(malformedMotion.frameDeltas[0]).toBeGreaterThan(0);
    expect(slowMotion.cadence).toBe("slow");
    expect(moderateMotion.cadence).toBe("moderate");
  });

  it("classifies static, stable, subtle, and fast sampled motion", () => {
    const darkFrame = makeFrame(1, 1, DARK_RGB, 0);
    const repeatedDarkFrame = makeFrame(1, 1, DARK_RGB, 1);
    const slightFrame = makeFrame(1, 1, 18, 1);
    const moderateFrame = makeFrame(1, 1, 50, 1);

    expect(buildInspiredesignMotionFacts([darkFrame]).posture).toBe("static_source_adaptation");
    expect(buildInspiredesignMotionFacts([darkFrame, repeatedDarkFrame]).cadence).toBe("static");
    expect(buildInspiredesignMotionFacts([darkFrame, slightFrame]).posture).toBe("stable_loop");
    expect(buildInspiredesignMotionFacts([darkFrame, moderateFrame]).posture).toBe("subtle_motion");
    expect(buildInspiredesignMotionFacts([darkFrame, slightFrame], 60).cadence).toBe("fast");
  });


  it("builds deterministic motion signatures and region ordering from sampled frames", () => {
    const base = makeFrame(9, 9, DARK_RGB, 0);
    const topLeft = makeFrame(9, 9, DARK_RGB, 1);
    const bottomRight = makeFrame(9, 9, DARK_RGB, 2);
    drawRect(topLeft, { x: 0, y: 0, width: 3, height: 3, value: LIGHT_RGB });
    drawRect(bottomRight, { x: 6, y: 6, width: 3, height: 3, value: LIGHT_RGB });

    const motion = buildInspiredesignMotionFacts([base, topLeft, bottomRight], 24);
    const repeat = buildInspiredesignMotionFacts([base, topLeft, bottomRight], 24);

    expect(JSON.stringify(motion)).toBe(JSON.stringify(repeat));
    expect(motion.motionSignature).toEqual(expect.objectContaining({
      version: 1,
      sampleBasis: "decoded_rgb_frames",
      motionFamily: "subtle_loop",
      dominantChangedRegions: expect.arrayContaining([
        expect.objectContaining({ row: 0, column: 0 }),
        expect.objectContaining({ row: 2, column: 2 })
      ])
    }));
    expect(motion.motionSignature?.dominantChangedRegions[0]?.averageDelta)
      .toBeGreaterThanOrEqual(motion.motionSignature?.dominantChangedRegions[1]?.averageDelta ?? 0);
  });

  it("classifies motion signature families from sampled frame facts", () => {
    const dark = makeFrame(1, 1, DARK_RGB, 0);
    const darkAgain = makeFrame(1, 1, DARK_RGB, 1);
    const slight = makeFrame(1, 1, 18, 1);
    const fade = makeFrame(1, 1, 50, 1);
    const dynamic = makeFrame(1, 1, 80, 1);
    const cut = makeFrame(1, 1, LIGHT_RGB, 1);

    expect(buildInspiredesignMotionFacts([dark, darkAgain]).motionSignature?.motionFamily).toBe("static_hold");
    expect(buildInspiredesignMotionFacts([dark, slight]).motionSignature?.motionFamily).toBe("subtle_loop");
    expect(buildInspiredesignMotionFacts([dark, fade]).motionSignature?.motionFamily).toBe("fade_or_exposure_shift");
    expect(buildInspiredesignMotionFacts([dark, dynamic]).motionSignature?.motionFamily).toBe("dynamic_motion");
    expect(buildInspiredesignMotionFacts([dark, cut]).motionSignature?.motionFamily).toBe("cut_or_scene_change");
    expect(buildInspiredesignMotionFacts([dark]).motionSignature).toBeUndefined();
  });

  it("attaches optional FFmpeg scene summaries to motion signatures", async () => {
    const ffprobe: InspiredesignFfprobeRunner = async () => ({
      value: { durationSeconds: 2, fps: 24, hasAudio: false, containerFormat: "mp4" },
      limitations: []
    });
    const ffmpeg: InspiredesignFfmpegFrameRunner = async () => ({
      value: { frames: [makeFrame(2, 2, DARK_RGB, 0), makeFrame(2, 2, LIGHT_RGB, 1)], outputWidth: 2, outputHeight: 2 },
      limitations: []
    });
    const ffmpegScene: InspiredesignFfmpegSceneRunner = async () => ({
      value: {
        detector: "ffmpeg_scdet",
        eventCount: 1,
        strongestScore: 0.64,
        timestampsSeconds: [0.5],
        limitations: []
      },
      limitations: []
    });

    const analysis = await analyzeInspiredesignMediaArtifacts([{
      ...trustedImageInput,
      kind: "video",
      contentType: "video/mp4",
      mediaPath: "pin-media-evidence/pin-a/video.mp4"
    }], { generatedAt: "2026-06-06T00:00:00.000Z", ffprobe, ffmpeg, ffmpegScene });

    expect(analysis.references[0]?.claimLevels).toContain("motion_sampled");
    expect(analysis.references[0]?.facts.motion?.motionSignature).toEqual(expect.objectContaining({
      motionFamily: "cut_or_scene_change",
      sceneSummary: expect.objectContaining({
        detector: "ffmpeg_scdet",
        eventCount: 1,
        strongestScore: 0.64,
        timestampsSeconds: [0.5]
      })
    }));
  });

  it("degrades scene-score failures to limitations without inventing scene facts", async () => {
    const ffprobe: InspiredesignFfprobeRunner = async () => ({ value: { hasAudio: false }, limitations: [] });
    const ffmpeg: InspiredesignFfmpegFrameRunner = async () => ({
      value: { frames: [makeFrame(2, 2, DARK_RGB, 0), makeFrame(2, 2, LIGHT_RGB, 1)], outputWidth: 2, outputHeight: 2 },
      limitations: []
    });
    const ffmpegScene: InspiredesignFfmpegSceneRunner = async () => ({ limitations: ["ffmpeg scene detection failed with exit code 7."] });

    const analysis = await analyzeInspiredesignMediaArtifacts([{
      ...trustedImageInput,
      kind: "gif",
      contentType: "image/gif",
      mediaPath: "pin-media-evidence/pin-a/main.gif"
    }], { generatedAt: "2026-06-06T00:00:00.000Z", ffprobe, ffmpeg, ffmpegScene });

    expect(analysis.references[0]?.claimLevels).toContain("motion_sampled");
    expect(analysis.references[0]?.facts.motion?.motionSignature?.sceneSummary).toBeUndefined();
    expect(analysis.references[0]?.limitations).toContain("ffmpeg scene detection failed with exit code 7.");
  });

  it("parses bounded FFmpeg scene-score stderr metadata", async () => {
    const binary = await makeFakeNodeBinary(
      `process.stderr.write(${JSON.stringify("lavfi.scd.score=0.25\nlavfi.scd.time=1.5\nlavfi.scd.score=0.5\nlavfi.scd.time=2.25\n")});`
    );

    try {
      const result = await runInspiredesignFfmpegSceneDetection(trustedImageInput.filePath, {
        binaryPath: binary.binaryPath,
        timeoutMs: 5000,
        metadata: { durationSeconds: 12 }
      });

      expect(result.value).toEqual({
        detector: "ffmpeg_scdet",
        eventCount: 2,
        strongestScore: 0.5,
        timestampsSeconds: [1.5, 2.25],
        limitations: []
      });
    } finally {
      await cleanupFakeBinary(binary.dir);
    }
  });

  it("covers FFmpeg scene detection timeout, nonzero, empty, and truncated event branches", async () => {
    const timeoutBinary = await makeFakeNodeBinary("setTimeout(() => {}, 1000);");
    const defaultTimeoutBinary = await makeFakeNodeBinary("setTimeout(() => {}, 6000);");
    const nonzeroBinary = await makeFakeNodeBinary("process.exit(9);");
    const noSceneBinary = await makeFakeNodeBinary(`process.stderr.write(${JSON.stringify("no scene metadata here\n")}); process.exit(0);`);
    const truncatedBinary = await makeFakeNodeBinary(
      `process.stderr.write(${JSON.stringify("lavfi.scd.score=0.2\nlavfi.scd.time=0.5\nlavfi.scd.score=0.3\nlavfi.scd.time=1.0\nlavfi.scd.score=0.4\nlavfi.scd.time=1.5\nlavfi.scd.score=0.5\nlavfi.scd.time=2.0\nlavfi.scd.score=0.6\nlavfi.scd.time=2.5\nlavfi.scd.score=0.7\nlavfi.scd.time=3.0\n")});`
    );

    try {
      await expect(runInspiredesignFfmpegSceneDetection(trustedImageInput.filePath, {
        binaryPath: timeoutBinary.binaryPath,
        timeoutMs: 10
      })).resolves.toEqual({ limitations: ["ffmpeg scene detection timed out after 10ms."] });

      await expect(runInspiredesignFfmpegSceneDetection(trustedImageInput.filePath, {
        binaryPath: defaultTimeoutBinary.binaryPath
      })).resolves.toEqual({ limitations: ["ffmpeg scene detection timed out after 5000ms."] });

      await expect(runInspiredesignFfmpegSceneDetection(trustedImageInput.filePath, {
        binaryPath: nonzeroBinary.binaryPath,
        timeoutMs: 5000
      })).resolves.toEqual({ limitations: ["ffmpeg scene detection failed with exit code 9."] });

      await expect(runInspiredesignFfmpegSceneDetection(trustedImageInput.filePath, {
        binaryPath: noSceneBinary.binaryPath,
        timeoutMs: 5000
      })).resolves.toEqual({
        value: {
          detector: "ffmpeg_scdet",
          eventCount: 0,
          strongestScore: 0,
          timestampsSeconds: [],
          limitations: []
        },
        limitations: []
      });

      await expect(runInspiredesignFfmpegSceneDetection(trustedImageInput.filePath, {
        binaryPath: truncatedBinary.binaryPath,
        timeoutMs: 5000
      })).resolves.toEqual({
        value: {
          detector: "ffmpeg_scdet",
          eventCount: 5,
          strongestScore: 0.7,
          timestampsSeconds: [0.5, 1, 1.5, 2, 2.5],
          limitations: ["Scene detection returned more than 5 events; output was truncated."]
        },
        limitations: []
      });
    } finally {
      await Promise.all([
        cleanupFakeBinary(timeoutBinary.dir),
        cleanupFakeBinary(defaultTimeoutBinary.dir),
        cleanupFakeBinary(nonzeroBinary.dir),
        cleanupFakeBinary(noSceneBinary.dir),
        cleanupFakeBinary(truncatedBinary.dir)
      ]);
    }
  });

  it("covers FFmpeg adapter process error branches", async () => {
    const throwingBinaryPath = join(tmpdir(), `missing-ffmpeg-${Date.now()}`);

    await expect(runInspiredesignFfmpegSceneDetection(trustedImageInput.filePath, {
      binaryPath: throwingBinaryPath,
      timeoutMs: 5000
    })).resolves.toEqual({ limitations: ["ffmpeg scene detection binary was not found."] });

    await expect(extractInspiredesignFfmpegFrames(trustedImageInput, {
      binaryPath: throwingBinaryPath,
      timeoutMs: 5000
    })).resolves.toEqual({ limitations: ["ffmpeg binary was not found."] });
  });

  it("maps OCR-free typography geometry across empty, aligned, and repeated regions", () => {
    const empty = analyzeInspiredesignTypographyStructure(makeFrame(0, 0, DARK_RGB));
    const frame = makeFrame(100, 100, DARK_RGB);
    drawRect(frame, { x: 4, y: 4, width: 8, height: 3, value: LIGHT_RGB });
    drawRect(frame, { x: 4, y: 20, width: 40, height: 12, value: LIGHT_RGB });
    drawRect(frame, { x: 4, y: 38, width: 10, height: 4, value: LIGHT_RGB });
    drawRect(frame, { x: 35, y: 45, width: 36, height: 5, value: LIGHT_RGB });
    drawRect(frame, { x: 72, y: 55, width: 12, height: 4, value: LIGHT_RGB });
    drawRect(frame, { x: 70, y: 76, width: 18, height: 4, value: LIGHT_RGB });
    drawRect(frame, { x: 70, y: 84, width: 18, height: 4, value: LIGHT_RGB });

    const typography = analyzeInspiredesignTypographyStructure(frame);
    const roles = typography.regions.map((region) => region.role);

    expect(empty.textRegionLayout.summary).toBe("No OCR-free text-like regions detected.");
    expect(empty.textRegionLayout.dominantAlignment).toBe("left");
    expect(roles).toEqual(expect.arrayContaining([
      "nav_row_candidate",
      "hero_headline_candidate",
      "cta_cluster_candidate",
      "support_copy_candidate",
      "text_region_candidate",
      "portfolio_caption_repetition"
    ]));
    expect(typography.regions.some((region) => region.alignment === "right")).toBe(true);
    expect(typography.textRegionLayout.repeatedRegionCount).toBeGreaterThan(0);
  });

  it("rejects implausible text regions and keeps right-weighted sparse typography OCR-free", () => {
    const noisyCorner = makeFrame(100, 100, LIGHT_RGB);
    const rightWeighted = makeFrame(100, 100, DARK_RGB);
    drawRect(noisyCorner, { x: 50, y: 50, width: 1, height: 1, value: DARK_RGB });
    drawRect(rightWeighted, { x: 72, y: 12, width: 18, height: 6, value: LIGHT_RGB });
    drawRect(rightWeighted, { x: 74, y: 32, width: 16, height: 6, value: LIGHT_RGB });

    const rejected = analyzeInspiredesignTypographyStructure(noisyCorner);
    const typography = analyzeInspiredesignTypographyStructure(rightWeighted);

    expect(rejected.regions).toHaveLength(0);
    expect(rejected.textRegionLayout.summary).toBe("No OCR-free text-like regions detected.");
    expect(typography.textRegionLayout.dominantAlignment).toBe("right");
    expect(typography.posture).toContain("sparse");
    expect(typography.posture).toContain("right-weighted");
    expect(typography.regions.every((region) => region.alignment === "right")).toBe(true);
    expect(typography.regions.every((region) => region.contrast === "high")).toBe(true);
  });

  it("keeps malformed RGB frames bounded while exercising missing channel fallbacks", () => {
    const noChannels: InspiredesignRgbFrame = { width: 1, height: 1, data: new Uint8Array([]), frameIndex: 0 };
    const oneChannel: InspiredesignRgbFrame = { width: 1, height: 1, data: new Uint8Array([LIGHT_RGB]), frameIndex: 1 };
    const twoChannels: InspiredesignRgbFrame = { width: 1, height: 1, data: new Uint8Array([LIGHT_RGB, MID_RGB]), frameIndex: 2 };
    const malformedTypography = analyzeInspiredesignTypographyStructure(twoChannels);

    const noChannelFacts = analyzeInspiredesignRgbFrame(noChannels);
    const oneChannelFacts = analyzeInspiredesignRgbFrame(oneChannel);
    const twoChannelFacts = analyzeInspiredesignRgbFrame(twoChannels);
    const motion = buildInspiredesignMotionFacts([oneChannel, twoChannels], 24);

    expect(noChannelFacts.palette).toEqual([]);
    expect(noChannelFacts.tone.meanLuminance).toBe(0);
    expect(noChannelFacts.tone.edgeDensity).toBe(0);
    expect(oneChannelFacts.palette[0]?.hex).toBe("#E02020");
    expect(twoChannelFacts.palette[0]?.hex).toBe("#E06020");
    expect(malformedTypography.textRegionLayout.regionCount).toBe(0);
    expect(motion.frameDeltas).toHaveLength(1);
    expect(motion.frameDeltas[0]).toBeGreaterThan(0);
  });

  it("keeps sparse frame-like buffers bounded without inventing missing RGB channels", () => {
    const sparseFrame: InspiredesignRgbFrame = { width: 1, height: 1, data: makeSparseFrameData(3), frameIndex: 0 };
    const lightFrame = makeFrame(1, 1, LIGHT_RGB, 1);

    const pixelFacts = analyzeInspiredesignRgbFrame(sparseFrame);
    const typography = analyzeInspiredesignTypographyStructure(sparseFrame);
    const sparseToLightMotion = buildInspiredesignMotionFacts([sparseFrame, lightFrame], 24);
    const lightToSparseMotion = buildInspiredesignMotionFacts([lightFrame, sparseFrame], 24);

    expect(pixelFacts.palette[0]).toEqual({ hex: "#202020", coverage: 1, roleHint: "background" });
    expect(pixelFacts.tone.meanLuminance).toBe(0);
    expect(pixelFacts.tone.edgeDensity).toBe(0);
    expect(typography.textRegionLayout.regionCount).toBe(0);
    expect(sparseToLightMotion.frameDeltas[0]).toBeGreaterThan(0);
    expect(lightToSparseMotion.frameDeltas[0]).toBeGreaterThan(0);
  });

  it("ignores overlong RGB buffers outside declared frame dimensions", () => {
    const overlongFrame: InspiredesignRgbFrame = {
      width: 1,
      height: 1,
      data: new Uint8Array(Array.from({ length: 30 }, (_, index) => index % RGB_CHANNEL_COUNT === 0 ? LIGHT_RGB : DARK_RGB)),
      frameIndex: 0
    };

    const pixelFacts = analyzeInspiredesignRgbFrame(overlongFrame);

    expect(pixelFacts.tone.meanLuminance).toBeGreaterThan(0);
    expect(pixelFacts.layout.zones.every((zone) => zone.bboxNorm[1] <= 1)).toBe(true);
  });

  it("keeps sparse sampled motion arrays bounded without inventing deltas", () => {
    const sparseFrames = [makeFrame(1, 1, DARK_RGB, 0)] as InspiredesignRgbFrame[];
    sparseFrames.length = 3;
    sparseFrames[2] = makeFrame(1, 1, LIGHT_RGB, 2);

    const motion = buildInspiredesignMotionFacts(sparseFrames, undefined);

    expect(motion.sampledFrameCount).toBe(3);
    expect(motion.frameDeltas).toEqual([]);
    expect(motion.averageFrameDelta).toBe(0);
    expect(motion.cadence).toBe("static");
    expect(motion.posture).toBe("stable_loop");
  });

  it("walks OCR-free text regions that touch every frame boundary", () => {
    const frame = makeFrame(100, 100, DARK_RGB);
    drawRect(frame, { x: 40, y: 0, width: 14, height: 3, value: LIGHT_RGB });
    drawRect(frame, { x: 0, y: 40, width: 14, height: 3, value: LIGHT_RGB });
    drawRect(frame, { x: 86, y: 52, width: 14, height: 3, value: LIGHT_RGB });
    drawRect(frame, { x: 40, y: 97, width: 14, height: 3, value: LIGHT_RGB });

    const typography = analyzeInspiredesignTypographyStructure(frame);

    expect(typography.regions).toHaveLength(4);
    expect(typography.regions.some((region) => region.alignment === "left")).toBe(true);
    expect(typography.regions.some((region) => region.alignment === "right")).toBe(true);
    expect(typography.regions.some((region) => region.role === "nav_row_candidate")).toBe(true);
    expect(typography.regions.some((region) => region.role === "portfolio_caption_repetition")).toBe(true);
  });

  it("builds media design guidance for dark, bright, static, and missing-fact branches", () => {
    const typography = analyzeInspiredesignTypographyStructure(makeEditorialFrame());
    const darkFacts: InspiredesignMediaFacts = {
      tone: {
        meanLuminance: 30,
        luminanceStandardDeviation: 70,
        darkCoverage: 0.62,
        brightCoverage: 0.08,
        midtoneCoverage: 0.3,
        contrastPosture: "high",
        densityPosture: "dense",
        edgeDensity: 0.2
      },
      palette: [{ hex: "#202020", coverage: 0.7, roleHint: "background" }],
      layout: {
        composition: "left-weighted split hero",
        whitespaceCoverage: 0.2,
        focalRegions: [],
        zones: [
          { role: "hero_copy", bboxNorm: [0, 0.33, 0.33, 0.33], confidence: 0.8 },
          { role: "hero_media", bboxNorm: [0.33, 0.33, 0.33, 0.33], confidence: 0.8 },
          { role: "cta_cluster", bboxNorm: [0, 0.66, 0.33, 0.33], confidence: 0.8 },
          { role: "portfolio_grid", bboxNorm: [0.33, 0.66, 0.33, 0.33], confidence: 0.8 }
        ]
      },
      typographyStructure: typography,
      motion: {
        sampledFrameCount: 2,
        sampledFrameIndexes: [0, 1],
        frameDeltas: [0.22],
        averageFrameDelta: 0.22,
        cadence: "moderate",
        posture: "dynamic_motion",
        frameToneSummaries: []
      }
    };
    const brightFacts: InspiredesignMediaFacts = {
      ...darkFacts,
      tone: {
        meanLuminance: 220,
        luminanceStandardDeviation: 36,
        darkCoverage: 0.02,
        brightCoverage: 0.58,
        midtoneCoverage: 0.4,
        contrastPosture: "moderate",
        densityPosture: "balanced",
        edgeDensity: 0.08
      },
      motion: undefined
    };
    const darkGuidance = buildInspiredesignMediaDesignGuidance({ facts: darkFacts, kind: "video", limitations: [], confidence: 0.8 });
    const brightGuidance = buildInspiredesignMediaDesignGuidance({ facts: brightFacts, kind: "image", limitations: [], confidence: 0.6 });
    const missingGuidance = buildInspiredesignMediaDesignGuidance({ facts: {}, kind: "gif", limitations: ["frames missing"], confidence: 0.1 });
    const emptyGuidance = buildEmptyInspiredesignMediaDesignGuidance(["no media"]);

    expect(darkGuidance.componentFamilies).toEqual(expect.arrayContaining(["hero", "CTA cluster", "portfolio grid or card set", "motion loop"]));
    expect(darkGuidance.patternsToBorrow).toContain("dark-dominant cinematic canvas with sparse bright controls");
    expect(darkGuidance.patternsToBorrow).toContain("dynamic sampled saved-media motion rhythm with reduced-motion adaptation");
    expect(brightGuidance.imageryPosture).toContain("bright-dominant");
    expect(brightGuidance.motionPosture).toContain("Static source only");
    expect(missingGuidance.visualRisks).toContain("frames missing");
    expect(missingGuidance.layoutRecipe).toContain("unavailable");
    expect(emptyGuidance.patternsToReject[0]).toContain("Do not invent media-derived");
    expect(confidenceLabel(0.8)).toBe("high");
    expect(confidenceLabel(0.6)).toBe("medium");
    expect(confidenceLabel(0.1)).toBe("low");
  });

  it("builds balanced media guidance while preserving OCR-free text limits", () => {
    const facts: InspiredesignMediaFacts = {
      tone: {
        meanLuminance: 132,
        luminanceStandardDeviation: 32,
        darkCoverage: 0.22,
        brightCoverage: 0.24,
        midtoneCoverage: 0.54,
        contrastPosture: "moderate",
        densityPosture: "balanced",
        edgeDensity: 0.06
      },
      palette: [{ hex: "#A0A0A0", coverage: 1, roleHint: "surface" }],
      layout: {
        composition: "centered editorial composition",
        whitespaceCoverage: 0.5,
        focalRegions: [],
        zones: []
      },
      typographyStructure: {
        readableTextAvailable: false,
        posture: "sparse, muted-contrast, center-weighted, OCR-free typography structure",
        regions: [],
        textRegionLayout: {
          summary: "OCR-free text-region geometry suggests no role candidates.",
          regionCount: 0,
          repeatedRegionCount: 0,
          dominantAlignment: "center"
        }
      },
      motion: {
        sampledFrameCount: 2,
        sampledFrameIndexes: [0, 1],
        frameDeltas: [0.04],
        averageFrameDelta: 0.04,
        cadence: "slow",
        posture: "stable_loop",
        frameToneSummaries: []
      }
    };
    const cutGuidance = buildInspiredesignMediaDesignGuidance({
      facts: {
        ...facts,
        motion: {
          ...facts.motion,
          posture: "dynamic_motion",
          motionSignature: {
            version: 1,
            sampleBasis: "decoded_rgb_frames",
            motionFamily: "cut_or_scene_change",
            peakFrameDelta: 0.5,
            averageFrameDelta: 0.3,
            deltaVariance: 0.08,
            toneShift: 0.2,
            dominantChangedRegions: [],
            confidence: 0.74,
            sceneSummary: {
              detector: "ffmpeg_scdet",
              eventCount: 2,
              strongestScore: 0.45,
              timestampsSeconds: [0.5, 1.25],
              limitations: []
            }
          }
        }
      },
      kind: "video",
      limitations: [],
      confidence: 0.7
    });
    const fadeGuidance = buildInspiredesignMediaDesignGuidance({
      facts: {
        ...facts,
        motion: {
          ...facts.motion,
          posture: "subtle_motion",
          motionSignature: {
            version: 1,
            sampleBasis: "decoded_rgb_frames",
            motionFamily: "fade_or_exposure_shift",
            peakFrameDelta: 0.16,
            averageFrameDelta: 0.12,
            deltaVariance: 0.01,
            toneShift: 0.22,
            dominantChangedRegions: [],
            confidence: 0.68
          }
        }
      },
      kind: "gif",
      limitations: [],
      confidence: 0.7
    });
    const staticGuidance = buildInspiredesignMediaDesignGuidance({
      facts: {
        ...facts,
        motion: {
          ...facts.motion,
          posture: "static_source_adaptation",
          motionSignature: {
            version: 1,
            sampleBasis: "decoded_rgb_frames",
            motionFamily: "static_hold",
            peakFrameDelta: 0,
            averageFrameDelta: 0,
            deltaVariance: 0,
            toneShift: 0,
            dominantChangedRegions: [],
            confidence: 0.6
          }
        }
      },
      kind: "gif",
      limitations: [],
      confidence: 0.7
    });

    const guidance = buildInspiredesignMediaDesignGuidance({
      facts,
      kind: "gif",
      limitations: [],
      confidence: 0.7
    });

    expect(guidance.visualRisks).toContain("Readable exact text extraction was not performed, so exact copy strings are unavailable.");
    expect(guidance.visualRisks).not.toContain("Palette claims are unavailable without decoded RGB frames.");
    expect(guidance.visualRisks).not.toContain("Real motion claims are unavailable without sampled frame deltas.");
    expect(guidance.imageryPosture).toContain("balanced luminance");
    expect(guidance.motionPosture).toContain("stable_loop saved-media motion sampled from 2 frames");
    expect(cutGuidance.motionPosture).toContain("signature family cut_or_scene_change");
    expect(cutGuidance.motionPosture).toContain("FFmpeg scene-score detected 2 sampled cut-like event(s), strongest score 0.45");
    expect(cutGuidance.motionPosture).toContain("Provide reduced-motion alternatives that preserve hierarchy without sampled video pacing.");
    expect(fadeGuidance.motionPosture).toContain("signature family fade_or_exposure_shift");
    expect(fadeGuidance.motionPosture).toContain("Provide reduced-motion alternatives that preserve hierarchy without sampled video pacing.");
    expect(staticGuidance.motionPosture).toContain("signature family static_hold");
    expect(staticGuidance.motionPosture).not.toContain("Provide reduced-motion alternatives");
    expect(guidance.patternsToReject).toContain("claiming exact headlines, nav labels, CTA copy, or font families from v1 media analysis");
  });
});

describe("inspiredesign media-analysis analyzer", () => {
  it("uses a deterministic generatedAt default", async () => {
    const analysis = await analyzeInspiredesignMediaArtifacts([]);

    expect(analysis.generatedAt).toBe(INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT);
  });

  it("builds stable image analysis without exact readable text or raw frame bytes", async () => {
    const ffprobe: InspiredesignFfprobeRunner = async () => ({
      value: {
        dimensions: { width: 800, height: 1080, aspectRatio: 0.7407 },
        frameCount: 1,
        hasAudio: false,
        containerFormat: "mjpeg",
        videoCodec: "mjpeg"
      },
      limitations: []
    });
    const ffmpeg: InspiredesignFfmpegFrameRunner = async () => ({
      value: { frames: [makeEditorialFrame()], outputWidth: 48, outputHeight: 64 },
      limitations: []
    });

    const analysis = await analyzeInspiredesignMediaArtifacts([trustedImageInput], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe,
      ffmpeg
    });
    const [reference] = analysis.references;
    const serialized = serializeInspiredesignMediaAnalysis(analysis);

    expect(analysis.nonGoals).toContain("media-analysis.json cannot satisfy product readiness.");
    expect(INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS).toContain("Readable exact text extraction is not part of v1.");
    expect(reference?.claimLevels).toEqual(expect.arrayContaining([
      "metadata_only",
      "pixel_stats",
      "palette_quantized",
      "layout_heuristic",
      "typography_structure",
      "text_region_layout"
    ]));
    expect(reference?.claimLevels).not.toContain("motion_sampled");
    expect(reference?.facts.typographyStructure?.readableTextAvailable).toBe(false);
    expect(reference?.designGuidance.patternsToReject.join(" ")).toContain("claiming exact headlines");
    expect(serialized).not.toContain("Home");
    expect(serialized).not.toContain("Browse my latest work");
    expect(serialized).not.toContain("\"data\":");
  });

  it("passes configured binary paths through the default adapters", async () => {
    const metadata = {
      streams: [
        {
          codec_type: "video",
          width: 1,
          height: 1,
          avg_frame_rate: "1/1",
          codec_name: "mjpeg"
        }
      ],
      format: { format_name: "mjpeg" }
    };
    const ffprobeBinary = await makeFakeNodeBinary(`process.stdout.write(${JSON.stringify(JSON.stringify(metadata))});`);
    const ffmpegBinary = await makeFakeNodeBinary(`
      if (process.argv.join(" ").includes("scdet")) {
        process.stderr.write(${JSON.stringify("lavfi.scd.score=0.45\nlavfi.scd.time=0.25\n")});
      } else {
        process.stdout.write(Buffer.from(${JSON.stringify([...makeFrame(1, 1, LIGHT_RGB).data, ...makeFrame(1, 1, DARK_RGB).data])}));
      }
    `);

    try {
      const analysis = await analyzeInspiredesignMediaArtifacts([
        { ...trustedImageInput, kind: "video", contentType: "video/mp4", width: 1, height: 1 }
      ], {
        generatedAt: "2026-06-06T00:00:00.000Z",
        ffprobeBinaryPath: ffprobeBinary.binaryPath,
        ffmpegBinaryPath: ffmpegBinary.binaryPath
      });
      const reference = analysis.references[0];

      expect(reference?.facts.metadata.videoCodec).toBe("mjpeg");
      expect(reference?.facts.dimensions).toEqual({ width: 1, height: 1, aspectRatio: 1 });
      expect(reference?.facts.tone?.meanLuminance).toBe(LIGHT_RGB);
      expect(reference?.claimLevels).toEqual(expect.arrayContaining([
        "metadata_only",
        "pixel_stats",
        "motion_sampled"
      ]));
      expect(reference?.facts.motion?.motionSignature?.sceneSummary).toEqual(expect.objectContaining({
        detector: "ffmpeg_scdet",
        eventCount: 1,
        strongestScore: 0.45,
        timestampsSeconds: [0.25]
      }));
    } finally {
      await Promise.all([
        cleanupFakeBinary(ffprobeBinary.dir),
        cleanupFakeBinary(ffmpegBinary.dir)
      ]);
    }
  });

  it("builds GIF and video motion facts from stubbed sampled frames", async () => {
    const ffprobe: InspiredesignFfprobeRunner = async () => ({
      value: {
        dimensions: { width: 700, height: 472, aspectRatio: 1.4831 },
        durationSeconds: 4.75,
        fps: 20,
        frameCount: 95,
        hasAudio: false,
        containerFormat: "gif",
        videoCodec: "gif"
      },
      limitations: []
    });
    const ffmpeg: InspiredesignFfmpegFrameRunner = async () => ({
      value: { frames: [makeFrame(8, 8, DARK_RGB, 0), makeFrame(8, 8, LIGHT_RGB, 1)], outputWidth: 8, outputHeight: 8 },
      limitations: []
    });
    const gifInput = { ...trustedImageInput, kind: "gif" as const, contentType: "image/gif", mediaPath: "pin-media-evidence/pin-a/main.gif" };

    const gifAnalysis = await analyzeInspiredesignMediaArtifacts([gifInput], { generatedAt: "2026-06-06T00:00:00.000Z", ffprobe, ffmpeg });
    const videoAnalysis = await analyzeInspiredesignMediaArtifacts([{ ...gifInput, kind: "video", contentType: "video/mp4" }], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe,
      ffmpeg
    });

    expect(gifAnalysis.references[0]?.claimLevels).toContain("motion_sampled");
    expect(gifAnalysis.references[0]?.facts.motion?.sampledFrameCount).toBe(2);
    expect(gifAnalysis.references[0]?.facts.motion?.averageFrameDelta).toBeGreaterThan(0.2);
    expect(videoAnalysis.references[0]?.claimLevels).toContain("motion_sampled");
  });

  it("keeps single-frame animated media metadata-only for motion and rejects partial input dimensions", async () => {
    const ffprobe: InspiredesignFfprobeRunner = async () => ({
      value: {
        frameCount: 1,
        hasAudio: false,
        containerFormat: "gif"
      },
      limitations: []
    });
    const ffmpeg: InspiredesignFfmpegFrameRunner = async () => ({
      value: { frames: [makeFrame(8, 8, MID_RGB, 0)], outputWidth: 8, outputHeight: 8 },
      limitations: []
    });

    const gifAnalysis = await analyzeInspiredesignMediaArtifacts([
      {
        ...trustedImageInput,
        kind: "gif",
        contentType: "image/gif",
        mediaPath: "pin-media-evidence/pin-a/main.gif"
      }
    ], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe,
      ffmpeg
    });
    const partialDimensionAnalysis = await analyzeInspiredesignMediaArtifacts([
      {
        ...trustedImageInput,
        width: undefined,
        height: 1080
      }
    ], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe: async () => ({ value: { hasAudio: false }, limitations: [] }),
      ffmpeg: async () => ({ limitations: [] })
    });

    expect(gifAnalysis.references[0]?.facts.motion?.sampledFrameCount).toBe(1);
    expect(gifAnalysis.references[0]?.claimLevels).not.toContain("motion_sampled");
    expect(partialDimensionAnalysis.references[0]?.facts.dimensions).toBeUndefined();
    expect(partialDimensionAnalysis.references[0]?.dimensions).toBeUndefined();
  });

  it("emits limitations without fake pixel, palette, typography, or motion claims when binaries are unavailable", async () => {
    const missingProbe: InspiredesignFfprobeRunner = async () => ({ limitations: ["ffprobe binary was not found."] });
    const missingFfmpeg: InspiredesignFfmpegFrameRunner = async () => ({ limitations: ["ffmpeg binary was not found."] });

    const analysis = await analyzeInspiredesignMediaArtifacts([trustedImageInput], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe: missingProbe,
      ffmpeg: missingFfmpeg
    });
    const reference = analysis.references[0];

    expect(reference?.claimLevels).toEqual(["metadata_only"]);
    expect(reference?.facts.metadata.hasAudio).toBeUndefined();
    expect(reference?.facts.tone).toBeUndefined();
    expect(reference?.facts.palette).toBeUndefined();
    expect(reference?.facts.typographyStructure).toBeUndefined();
    expect(reference?.facts.motion).toBeUndefined();
    expect(reference?.limitations).toEqual(expect.arrayContaining(["ffprobe binary was not found.", "ffmpeg binary was not found."]));
    expect(reference?.designGuidance.patternsToReject[0]).toContain("Do not invent media-derived");
  });

  it("short-circuits configured unavailable binary limitations before spawning adapters", async () => {
    const ffprobe = vi.fn<InspiredesignFfprobeRunner>();
    const ffmpeg = vi.fn<InspiredesignFfmpegFrameRunner>();

    const analysis = await analyzeInspiredesignMediaArtifacts([{
      ...trustedImageInput,
      kind: "video",
      contentType: "video/mp4",
      width: 800,
      height: 1080
    }], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe,
      ffmpeg,
      ffprobeUnavailableLimitation: "ffprobe binary was not found.",
      ffmpegUnavailableLimitation: "ffmpeg binary was not found."
    });
    const reference = analysis.references[0];

    expect(ffprobe).not.toHaveBeenCalled();
    expect(ffmpeg).not.toHaveBeenCalled();
    expect(reference?.claimLevels).toEqual(["metadata_only"]);
    expect(reference?.facts.dimensions).toBeUndefined();
    expect(reference?.facts.tone).toBeUndefined();
    expect(reference?.limitations).toEqual(expect.arrayContaining([
      "ffprobe binary was not found.",
      "ffmpeg binary was not found."
    ]));
  });

  it("does not invent dimensions or pixel claim levels when adapters and dimensions are empty", async () => {
    const noProbeFacts: InspiredesignFfprobeRunner = async () => ({ limitations: [] });
    const noFrames: InspiredesignFfmpegFrameRunner = async () => ({ limitations: [] });

    const analysis = await analyzeInspiredesignMediaArtifacts([{
      ...trustedImageInput,
      width: undefined,
      height: undefined
    }], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe: noProbeFacts,
      ffmpeg: noFrames
    });
    const reference = analysis.references[0];

    expect(reference?.claimLevels).toEqual(["metadata_only"]);
    expect(reference?.facts.metadata).toEqual({});
    expect(reference?.facts.dimensions).toBeUndefined();
    expect(reference?.designGuidance.visualRisks).toEqual(expect.arrayContaining([
      "Readable exact text extraction was not performed, so exact copy strings are unavailable."
    ]));
    expect(reference?.designGuidance.visualRisks).not.toContain("Palette claims are unavailable without decoded RGB frames.");
  });

  it("keeps video audio presence unknown when ffprobe is unavailable", async () => {
    const missingProbe: InspiredesignFfprobeRunner = async () => ({ limitations: ["ffprobe binary was not found."] });
    const ffmpeg: InspiredesignFfmpegFrameRunner = async () => ({
      value: { frames: [makeFrame(8, 8, DARK_RGB, 0), makeFrame(8, 8, LIGHT_RGB, 1)], outputWidth: 8, outputHeight: 8 },
      limitations: []
    });

    const analysis = await analyzeInspiredesignMediaArtifacts([
      { ...trustedImageInput, kind: "video", contentType: "video/mp4", mediaPath: "pin-media-evidence/pin-a/video.mp4" }
    ], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe: missingProbe,
      ffmpeg
    });
    const reference = analysis.references[0];
    const serialized = serializeInspiredesignMediaAnalysis(analysis);

    expect(reference?.facts.metadata.hasAudio).toBeUndefined();
    expect(reference?.facts.metadata.dimensions).toBeUndefined();
    expect(reference?.dimensions).toBeUndefined();
    expect(reference?.claimLevels).toContain("motion_sampled");
    expect(serialized).not.toContain("\"hasAudio\":false");
    expect(serialized).not.toContain("\"dimensions\"");
  });

  it("does not probe media when the analysis budget is exhausted before the first reference", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    const ffprobe = vi.fn<InspiredesignFfprobeRunner>();
    const ffmpeg = vi.fn<InspiredesignFfmpegFrameRunner>();

    try {
      const analysis = await analyzeInspiredesignMediaArtifacts([
        {
          ...trustedImageInput,
          kind: "video",
          contentType: "video/mp4",
          mediaPath: "pin-media-evidence/pin-a/video.mp4",
          width: 800,
          height: 1080
        }
      ], {
        generatedAt: "2026-06-06T00:00:00.000Z",
        timeoutMs: 0,
        ffprobe,
        ffmpeg
      });

      expect(ffprobe).not.toHaveBeenCalled();
      expect(ffmpeg).not.toHaveBeenCalled();
      expect(analysis.references[0]?.limitations).toEqual([
        "Media analysis stopped because the workflow timeout budget was exhausted."
      ]);
      expect(analysis.references[0]?.facts.dimensions).toBeUndefined();
      expect(analysis.references[0]?.claimLevels).toEqual(["metadata_only"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears FFmpeg and FFprobe timeout handles on spawn errors", async () => {
    vi.useFakeTimers();
    try {
      const missingBinary = "/tmp/opendevbrowser-missing-media-analysis-binary";
      const directoryBinary = await mkdtemp(join(tmpdir(), "odb-media-analysis-directory-binary-"));
      const ffmpegResult = await extractInspiredesignFfmpegFrames(trustedImageInput, {
        binaryPath: missingBinary,
        timeoutMs: 10_000
      });
      const ffprobeResult = await runInspiredesignFfprobe(trustedImageInput.filePath, {
        binaryPath: missingBinary,
        timeoutMs: 10_000
      });
      const ffmpegDirectoryResult = await extractInspiredesignFfmpegFrames(trustedImageInput, {
        binaryPath: directoryBinary,
        timeoutMs: 10_000
      });
      const ffprobeDirectoryResult = await runInspiredesignFfprobe(trustedImageInput.filePath, {
        binaryPath: directoryBinary,
        timeoutMs: 10_000
      });

      expect(ffmpegResult.limitations[0]).toContain("binary was not found");
      expect(ffprobeResult.limitations[0]).toContain("binary was not found");
      expect(ffmpegDirectoryResult.limitations[0]).toContain("ffmpeg failed:");
      expect(ffprobeDirectoryResult.limitations[0]).toContain("ffprobe failed:");
      expect(vi.getTimerCount()).toBe(0);
      await rm(directoryBinary, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops frame extraction when the media-analysis timeout budget is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    const ffmpeg = vi.fn<InspiredesignFfmpegFrameRunner>();
    const ffprobe: InspiredesignFfprobeRunner = async (_filePath, options) => {
      expect(options?.timeoutMs).toBe(10);
      vi.setSystemTime(new Date("2026-06-06T00:00:00.010Z"));
      return {
        value: {
          dimensions: { width: 800, height: 1080, aspectRatio: 0.7407 },
          hasAudio: false
        },
        limitations: []
      };
    };

    try {
      const analysis = await analyzeInspiredesignMediaArtifacts([trustedImageInput], {
        generatedAt: "2026-06-06T00:00:00.000Z",
        timeoutMs: 10,
        ffprobe,
        ffmpeg
      });

      expect(ffmpeg).not.toHaveBeenCalled();
      expect(analysis.references[0]?.limitations).toContain("Media analysis stopped because the workflow timeout budget was exhausted.");
      expect(analysis.references[0]?.claimLevels).toEqual(["metadata_only"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("excludes diagnostic or unscheduled media from analysis", async () => {
    const ffprobe: InspiredesignFfprobeRunner = async () => ({ limitations: [] });
    const ffmpeg: InspiredesignFfmpegFrameRunner = async () => ({ limitations: [] });
    const diagnosticInput = { ...trustedImageInput, authority: "diagnostic" as const };
    const unscheduledInput = { ...trustedImageInput, referenceId: "pin-b", scheduledForBundle: false };

    const analysis = await analyzeInspiredesignMediaArtifacts([diagnosticInput, unscheduledInput], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe,
      ffmpeg
    });

    expect(analysis.references).toEqual([]);
  });

  it("persists deterministic media analysis with the default writer", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-persist-"));
    const outputPath = join(outputDir, "media-analysis.json");
    const analysis = await analyzeInspiredesignMediaArtifacts([], {
      generatedAt: "2026-06-06T00:00:00.000Z"
    });

    try {
      await persistInspiredesignMediaAnalysis(outputPath, analysis);

      expect(await import("node:fs/promises").then(({ readFile }) => readFile(outputPath, "utf8")))
        .toBe(serializeInspiredesignMediaAnalysis(analysis));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
