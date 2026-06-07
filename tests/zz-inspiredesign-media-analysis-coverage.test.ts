import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeInspiredesignMediaArtifacts,
  analyzeInspiredesignRgbFrame,
  analyzeInspiredesignTypographyStructure,
  buildEmptyInspiredesignMediaDesignGuidance,
  buildInspiredesignMediaDesignGuidance,
  buildInspiredesignMotionFacts,
  calculateBoundedFrameSize,
  confidenceLabel,
  extractInspiredesignFfmpegFrames,
  runInspiredesignFfprobe,
  serializeInspiredesignMediaAnalysis,
  summarizeInspiredesignMediaReferenceForBoard,
  type InspiredesignFfmpegFrameRunner,
  type InspiredesignFfprobeRunner,
  type InspiredesignMediaAnalysisInput,
  type InspiredesignMediaFacts,
  type InspiredesignRgbFrame
} from "../src/inspiredesign/media-analysis";
import { listSiteRecipes, resolveSiteRecipeForProvider, resolveSiteRecipeForUrl } from "../src/guidance/recipes/site-registry";
import {
  captureInspiredesignPrimaryMotionEvidenceFromManager,
  captureInspiredesignPrimaryPinMediaEvidenceFromManager
} from "../src/inspiredesign/capture";
import {
  classifyPinterestCandidate,
  classifyPinterestSourcePage,
  resolvePinterestPrimaryCaptureStrategy,
  shouldBlockPinterestSourceExtraction,
  summarizePinterestClassifications
} from "../src/inspiredesign/pinterest-media-classification";
import {
  hasInspiredesignArtifactBackedEvidenceAuthority,
  type InspiredesignPinMediaAuthorityInput,
  type InspiredesignRankedReferenceAuthorityInput
} from "../src/inspiredesign/product-readiness";
import { persistInspiredesignVisualEvidence } from "../src/inspiredesign/visual-evidence";
import { decideInspiredesignVisualCapturePolicy } from "../src/inspiredesign/visual-policy";
import type { InspiredesignBriefFormat } from "../src/inspiredesign/brief-expansion";
import {
  buildInspiredesignReferencePatternBoard,
  hasInspiredesignUsableReferenceEvidence
} from "../src/inspiredesign/reference-pattern-board";
import {
  MIN_PIN_MEDIA_EVIDENCE_BYTES,
  hasPinterestPinMediaAuthorityBlockingWarning,
  hasPinterestPinMediaBlockingWarning,
  inspectPinterestPinMediaBuffer,
  persistInspiredesignPinterestPinMediaEvidence
} from "../src/inspiredesign/pinterest-pin-media-evidence";

const RGB_CHANNEL_COUNT = 3;
const DARK_RGB = 8;
const LIGHT_RGB = 245;
const MID_RGB = 120;
const ACCENT_RGB = 210;
const ACTIVE_LAYOUT_RGB = 155;
const PINTEREST_PIN_URL = "https://www.pinterest.com/pin/61572719900827789/";
const PIN_MEDIA_URL = "https://i.pinimg.com/originals/aa/bb/cc/example.jpg";
const SHA_256_HEX = "a".repeat(64);
const MP4_FIXED_POINT_SCALE = 65_536;
const MP4_TKHD_VERSION_0_PAYLOAD_BYTES = 84;
const MP4_TKHD_VERSION_1_PAYLOAD_BYTES = 96;
const MP4_TKHD_VERSION_0_DIMENSIONS_OFFSET = 76;
const MP4_TKHD_VERSION_1_DIMENSIONS_OFFSET = 88;

type PrimaryPinMediaCaptureManager = Parameters<typeof captureInspiredesignPrimaryPinMediaEvidenceFromManager>[0];
type PrimaryMotionCaptureManager = Parameters<typeof captureInspiredesignPrimaryMotionEvidenceFromManager>[0];

const makePrimaryPinMediaCaptureManager = (
  captureResult: Record<string, unknown>,
  snapshot: Record<string, unknown> = { url: PINTEREST_PIN_URL, title: "Pinterest pin", content: "", warnings: [] }
): PrimaryPinMediaCaptureManager => ({
  launch: async () => ({ sessionId: "pin-media-session" }),
  cookieImport: async () => ({ imported: 0, rejected: [] }),
  cookieList: async () => ({ cookies: [] }),
  goto: async () => undefined,
  waitForLoad: async () => undefined,
  snapshot: async () => snapshot,
  clonePage: async () => ({ html: "", title: "", url: PINTEREST_PIN_URL }),
  disconnect: async () => undefined,
  capturePinterestPinMedia: async () => captureResult
} as PrimaryPinMediaCaptureManager);

const makePrimaryMotionCaptureManager = (
  snapshot: Record<string, unknown> = {
    url: PINTEREST_PIN_URL,
    title: "Pinterest pin",
    content: "data-test-id=\"closeup-image\" Save this pin",
    warnings: []
  }
): PrimaryMotionCaptureManager => ({
  launch: async () => ({ sessionId: "motion-session" }),
  cookieImport: async () => ({ imported: 0, rejected: [] }),
  cookieList: async () => ({ cookies: [] }),
  goto: async () => undefined,
  waitForLoad: async () => undefined,
  snapshot: async () => snapshot,
  clonePage: async () => ({ html: "", title: "Pinterest pin", url: PINTEREST_PIN_URL }),
  clonePageHtmlWithOptions: async () => ({
    html: "<img data-test-id=\"closeup-image\" src=\"pin.jpg\" />",
    title: "Pinterest pin",
    url: PINTEREST_PIN_URL
  }),
  disconnect: async () => undefined,
  startScreencast: async () => ({ screencastId: "motion-capture" }),
  stopScreencast: async () => ({
    endedAt: "2026-06-07T00:00:00.000Z",
    manifestPath: "/tmp/odb-motion/replay.json",
    replayHtmlPath: "/tmp/odb-motion/replay.html",
    previewPath: "/tmp/odb-motion/preview.png",
    outputDir: "/tmp/odb-motion",
    frameCount: 3,
    warnings: ["motion_sampled"]
  })
} as PrimaryMotionCaptureManager);

const minimalBriefFormat: InspiredesignBriefFormat = {
  id: "coverage-minimal",
  label: "Coverage Minimal",
  keywords: ["premium", "photography"],
  bestFor: ["landing pages"],
  businessFocus: ["portfolio"],
  archetype: "site",
  layoutArchetype: "page",
  surfaceTreatment: "cinematic",
  shapeLanguage: "rectangular",
  paletteIntent: "dark editorial palette",
  typographySystem: "editorial serif with grotesk support",
  motionGrammar: "measured scroll reveal",
  componentGrammar: "hero, proof, portfolio, CTA",
  visualDensity: "airy",
  designVariance: "balanced",
  responsiveCollapseRules: ["Collapse to one column."],
  guardrails: ["Keep evidence first."],
  antiPatterns: ["Do not use generic cards."],
  deliverables: ["Design contract."],
  route: {
    profile: "product-story",
    themeStrategy: "single-theme",
    navigationModel: "global-header",
    layoutApproach: "editorial-hero-sequence"
  }
};

const trustedImageInput: InspiredesignMediaAnalysisInput = {
  referenceId: "pin-media-coverage",
  mediaPath: "pin-media-evidence/pin-media-coverage/main.jpg",
  filePath: "/tmp/pin-media-coverage.jpg",
  sourceUrl: "https://www.pinterest.com/pin/123/",
  mediaUrl: "https://i.pinimg.com/originals/example.jpg",
  kind: "image",
  contentType: "image/jpeg",
  bytes: 4096,
  hash: "b".repeat(64),
  width: 800,
  height: 1080,
  authority: "design_evidence",
  scheduledForBundle: true
};

const makeFrame = (width: number, height: number, fill: number, frameIndex = 0): InspiredesignRgbFrame => {
  const data = new Uint8Array(width * height * RGB_CHANNEL_COUNT);
  for (let offset = 0; offset < data.length; offset += RGB_CHANNEL_COUNT) {
    data[offset] = fill;
    data[offset + 1] = fill;
    data[offset + 2] = fill;
  }
  return { width, height, data, frameIndex };
};

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
  const frame = makeFrame(60, 72, DARK_RGB);
  drawRect(frame, { x: 4, y: 3, width: 28, height: 2, value: LIGHT_RGB });
  drawRect(frame, { x: 4, y: 16, width: 24, height: 10, value: LIGHT_RGB });
  drawRect(frame, { x: 4, y: 32, width: 14, height: 4, value: MID_RGB });
  drawRect(frame, { x: 36, y: 10, width: 18, height: 26, value: MID_RGB });
  drawRect(frame, { x: 5, y: 56, width: 16, height: 4, value: LIGHT_RGB });
  drawRect(frame, { x: 34, y: 56, width: 16, height: 4, value: LIGHT_RGB });
  return frame;
};

const makeRawRgbBytes = (frames: readonly InspiredesignRgbFrame[]): number[] => [
  ...frames.flatMap((frame) => [...frame.data])
];

const makeMp4Box = (type: string, payload: Buffer): Buffer => {
  const box = Buffer.alloc(8 + payload.length, 0);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, "ascii");
  payload.copy(box, 8);
  return box;
};

const makeMp4Ftyp = (): Buffer => {
  const ftyp = Buffer.alloc(24, 0);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("isom", 8, "ascii");
  ftyp.write("iso2", 12, "ascii");
  ftyp.write("avc1", 16, "ascii");
  ftyp.write("mp41", 20, "ascii");
  return ftyp;
};

const makeMp4TkhdPayload = (version: number, width: number, height: number): Buffer => {
  const dimensionsOffset = version === 1 ? MP4_TKHD_VERSION_1_DIMENSIONS_OFFSET : MP4_TKHD_VERSION_0_DIMENSIONS_OFFSET;
  const payloadLength = version === 1 ? MP4_TKHD_VERSION_1_PAYLOAD_BYTES : MP4_TKHD_VERSION_0_PAYLOAD_BYTES;
  const payload = Buffer.alloc(payloadLength, 0);
  payload[0] = version;
  payload.writeUInt32BE(width * MP4_FIXED_POINT_SCALE, dimensionsOffset);
  payload.writeUInt32BE(height * MP4_FIXED_POINT_SCALE, dimensionsOffset + 4);
  return payload;
};

const makeNestedMp4Bytes = (tkhdPayload: Buffer): Buffer => {
  const media = Buffer.concat([
    makeMp4Ftyp(),
    makeMp4Box("moov", Buffer.concat([
      makeMp4Box("free", Buffer.alloc(4, 0)),
      makeMp4Box("trak", makeMp4Box("tkhd", tkhdPayload))
    ]))
  ]);
  return Buffer.concat([media, Buffer.alloc(Math.max(0, MIN_PIN_MEDIA_EVIDENCE_BYTES + 1 - media.length), 0)]);
};

const makeMalformedNestedMp4Bytes = (childBoxSize: number): Buffer => {
  const malformedChild = Buffer.alloc(8, 0);
  malformedChild.writeUInt32BE(childBoxSize, 0);
  malformedChild.write("trak", 4, "ascii");
  const media = Buffer.concat([makeMp4Ftyp(), makeMp4Box("moov", malformedChild)]);
  return Buffer.concat([media, Buffer.alloc(Math.max(0, MIN_PIN_MEDIA_EVIDENCE_BYTES + 1 - media.length), 0)]);
};

const makeJpegPinMediaBytes = (): Buffer => {
  const header = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x02, 0x80,
    0x02, 0x80,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  return Buffer.concat([header, Buffer.alloc(MIN_PIN_MEDIA_EVIDENCE_BYTES + 1 - header.length, 0)]);
};

const makeFakeNodeBinary = async (body: string): Promise<{ dir: string; binaryPath: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "odb-media-analysis-coverage-"));
  const binaryPath = join(dir, "fake-binary.cjs");
  await writeFile(binaryPath, `#!/usr/bin/env node\n${body}\n`);
  await chmod(binaryPath, 0o755);
  return { dir, binaryPath };
};

const cleanupFakeBinary = async (dir: string): Promise<void> => {
  await rm(dir, { recursive: true, force: true });
};

const makeTrustedPinMedia = (
  overrides: Partial<InspiredesignPinMediaAuthorityInput> = {}
): InspiredesignPinMediaAuthorityInput => ({
  referenceId: "pin-media-coverage",
  url: PINTEREST_PIN_URL,
  sourceUrl: PINTEREST_PIN_URL,
  mediaUrl: PIN_MEDIA_URL,
  pinterestPageQuality: "pin_media",
  path: "pin-media-evidence/pin-media-coverage/main.jpg",
  sha256: SHA_256_HEX,
  bytes: 4096,
  width: 640,
  height: 640,
  contentType: "image/jpeg",
  kind: "image",
  authority: "design_evidence",
  warnings: [],
  firstPartyProvenance: {
    canonicalReferenceUrl: PINTEREST_PIN_URL,
    canonicalSourceUrl: PINTEREST_PIN_URL,
    referenceUrlCanonical: true,
    sourceUrlMatchesReference: true,
    mediaUrlFirstParty: true
  },
  ...overrides
});

const trustedPinterestReference = (
  overrides: Partial<InspiredesignRankedReferenceAuthorityInput> = {}
): InspiredesignRankedReferenceAuthorityInput => ({
  id: "pin-media-coverage",
  url: PINTEREST_PIN_URL,
  evidenceAuthority: "pin_media_ready",
  ...overrides
});

const makeReferenceBoardPinMedia = (overrides: Partial<InspiredesignPinMediaAuthorityInput> = {}) => {
  const metadata = {
    status: "captured" as const,
    kind: "image" as const,
    capturedAt: "2026-06-07T00:00:00.000Z",
    referenceId: "pin-media-coverage",
    url: PINTEREST_PIN_URL,
    sourceUrl: PINTEREST_PIN_URL,
    pinterestPageQuality: "pin_media" as const,
    mediaUrl: PIN_MEDIA_URL,
    width: 640,
    height: 640,
    contentType: "image/jpeg",
    warnings: [],
    rejectionReasons: [],
    ...overrides
  };
  return persistInspiredesignPinterestPinMediaEvidence(metadata, {
    artifactPath: "pin-media-evidence/pin-media-coverage/main.jpg",
    buffer: makeJpegPinMediaBytes()
  });
};

describe("inspiredesign media-analysis full-suite coverage regression", () => {
  it("exercises FFprobe and FFmpeg adapter branches late in the suite", async () => {
    const metadata = {
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
    const firstFrame = makeFrame(2, 1, DARK_RGB, 0);
    const secondFrame = makeFrame(2, 1, LIGHT_RGB, 1);
    const metadataBinary = await makeFakeNodeBinary(`process.stdout.write(${JSON.stringify(JSON.stringify(metadata))});`);
    const invalidJsonBinary = await makeFakeNodeBinary("process.stdout.write('{not json');");
    const ffprobeFailureBinary = await makeFakeNodeBinary("process.exitCode = 7;");
    const ffmpegFrameBinary = await makeFakeNodeBinary(
      `process.stdout.write(Buffer.from(${JSON.stringify(makeRawRgbBytes([firstFrame, secondFrame]))}));`
    );
    const ffmpegEmptyBinary = await makeFakeNodeBinary("");
    const ffmpegFailureBinary = await makeFakeNodeBinary("process.exitCode = 9;");

    try {
      const parsedMetadata = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: metadataBinary.binaryPath });
      const invalidJson = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: invalidJsonBinary.binaryPath });
      const ffprobeFailure = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: ffprobeFailureBinary.binaryPath });
      const imageFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, width: 2, height: 1 },
        { binaryPath: ffmpegFrameBinary.binaryPath, maxWidth: 2, maxHeight: 1, maxFrames: 5 }
      );
      const videoFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, kind: "video", contentType: "video/mp4", width: 2, height: 1 },
        { binaryPath: ffmpegFrameBinary.binaryPath, maxWidth: 2, maxHeight: 1, maxFrames: 2 }
      );
      const emptyFrames = await extractInspiredesignFfmpegFrames(
        { ...trustedImageInput, width: 2, height: 1 },
        { binaryPath: ffmpegEmptyBinary.binaryPath, maxWidth: 2, maxHeight: 1 }
      );
      const ffmpegFailure = await extractInspiredesignFfmpegFrames(trustedImageInput, {
        binaryPath: ffmpegFailureBinary.binaryPath
      });
      const defaultSize = calculateBoundedFrameSize({});

      expect(parsedMetadata.value).toEqual(expect.objectContaining({
        dimensions: { width: 640, height: 320, aspectRatio: 2 },
        fps: 59.9401,
        frameCount: 7,
        audioCodec: "aac",
        hasAudio: true
      }));
      expect(invalidJson.limitations[0]).toContain("ffprobe JSON could not be parsed");
      expect(ffprobeFailure.limitations[0]).toBe("ffprobe failed with exit code 7.");
      expect(imageFrames.value?.frames).toHaveLength(1);
      expect(videoFrames.value?.frames).toHaveLength(2);
      expect(emptyFrames.limitations[0]).toBe("ffmpeg produced no decodable RGB frames.");
      expect(ffmpegFailure.limitations[0]).toBe("ffmpeg failed with exit code 9.");
      expect(defaultSize).toEqual({ width: 160, height: 160 });
    } finally {
      await Promise.all([
        cleanupFakeBinary(metadataBinary.dir),
        cleanupFakeBinary(invalidJsonBinary.dir),
        cleanupFakeBinary(ffprobeFailureBinary.dir),
        cleanupFakeBinary(ffmpegFrameBinary.dir),
        cleanupFakeBinary(ffmpegEmptyBinary.dir),
        cleanupFakeBinary(ffmpegFailureBinary.dir)
      ]);
    }
  });

  it("exercises pixel, typography, guidance, and motion branches late in the suite", () => {
    const editorialFrame = makeEditorialFrame();
    const lowerGrid = makeFrame(9, 9, MID_RGB);
    const portfolioGrid = makeFrame(9, 9, MID_RGB);
    const denseGrid = makeFrame(9, 9, MID_RGB);
    const rightWeightedText = makeFrame(100, 100, DARK_RGB);
    const isolatedContrastPixel = makeFrame(10, 10, DARK_RGB);
    const paletteFrame = makeFrame(4, 1, DARK_RGB);
    const overlongFrame: InspiredesignRgbFrame = {
      width: 1,
      height: 1,
      data: new Uint8Array(Array.from({ length: 30 }, (_, index) => index % RGB_CHANNEL_COUNT === 0 ? LIGHT_RGB : DARK_RGB)),
      frameIndex: 0
    };
    const sparseFrames = [makeFrame(1, 1, DARK_RGB, 0)] as InspiredesignRgbFrame[];
    sparseFrames.length = 3;
    sparseFrames[2] = makeFrame(1, 1, LIGHT_RGB, 2);

    drawRect(lowerGrid, { x: 0, y: 6, width: 6, height: 3, value: ACTIVE_LAYOUT_RGB });
    drawRect(portfolioGrid, { x: 3, y: 6, width: 3, height: 3, value: ACTIVE_LAYOUT_RGB });
    drawRect(denseGrid, { x: 0, y: 0, width: 3, height: 3, value: ACTIVE_LAYOUT_RGB });
    drawRect(denseGrid, { x: 3, y: 0, width: 3, height: 3, value: ACTIVE_LAYOUT_RGB });
    drawRect(denseGrid, { x: 6, y: 0, width: 3, height: 3, value: ACTIVE_LAYOUT_RGB });
    drawRect(denseGrid, { x: 6, y: 3, width: 3, height: 3, value: ACTIVE_LAYOUT_RGB });
    drawRect(rightWeightedText, { x: 72, y: 12, width: 18, height: 6, value: LIGHT_RGB });
    drawRect(rightWeightedText, { x: 74, y: 32, width: 16, height: 6, value: LIGHT_RGB });
    drawRect(isolatedContrastPixel, { x: 5, y: 5, width: 1, height: 1, value: LIGHT_RGB });
    paletteFrame.data.set([LIGHT_RGB, LIGHT_RGB, LIGHT_RGB], 3);
    paletteFrame.data.set([MID_RGB, MID_RGB, MID_RGB], 6);
    paletteFrame.data.set([ACCENT_RGB, 80, 40], 9);

    const pixelFacts = analyzeInspiredesignRgbFrame(editorialFrame);
    const lowerGridFacts = analyzeInspiredesignRgbFrame(lowerGrid);
    const portfolioGridFacts = analyzeInspiredesignRgbFrame(portfolioGrid);
    const denseGridFacts = analyzeInspiredesignRgbFrame(denseGrid);
    const paletteHints = analyzeInspiredesignRgbFrame(paletteFrame).palette.map((swatch) => swatch.roleHint);
    const overlongFacts = analyzeInspiredesignRgbFrame(overlongFrame);
    const typography = analyzeInspiredesignTypographyStructure(rightWeightedText);
    const isolatedTypography = analyzeInspiredesignTypographyStructure(isolatedContrastPixel);
    const sparseMotion = buildInspiredesignMotionFacts(sparseFrames, undefined);
    const dynamicMotion = buildInspiredesignMotionFacts([makeFrame(1, 1, DARK_RGB, 0), makeFrame(1, 1, LIGHT_RGB, 1)], 60);
    const facts: InspiredesignMediaFacts = {
      tone: pixelFacts.tone,
      palette: pixelFacts.palette,
      layout: pixelFacts.layout,
      typographyStructure: typography,
      motion: dynamicMotion
    };
    const guidance = buildInspiredesignMediaDesignGuidance({ facts, kind: "gif", limitations: [], confidence: 0.8 });
    const emptyGuidance = buildEmptyInspiredesignMediaDesignGuidance(["no decoded frames"]);

    expect(lowerGridFacts.layout.composition).toBe("upper hero with lower grid");
    expect(portfolioGridFacts.layout.zones.some((zone) => zone.role === "portfolio_grid")).toBe(true);
    expect(denseGridFacts.layout.composition).toBe("dense grid composition");
    expect(paletteHints).toEqual(["background", "foreground", "muted foreground", "accent"]);
    expect(overlongFacts.layout.zones.every((zone) => zone.bboxNorm[1] <= 1)).toBe(true);
    expect(typography.textRegionLayout.dominantAlignment).toBe("right");
    expect(isolatedTypography.textRegionLayout.regionCount).toBe(1);
    expect(sparseMotion.frameDeltas).toEqual([]);
    expect(dynamicMotion.cadence).toBe("fast");
    expect(guidance.patternsToBorrow).toEqual(expect.arrayContaining([
      "OCR-free typography hierarchy using measured role candidates",
      "dynamic sampled motion rhythm with reduced-motion adaptation"
    ]));
    expect(emptyGuidance.visualRisks).toContain("no decoded frames");
    expect(confidenceLabel(0.8)).toBe("high");
    expect(confidenceLabel(0.6)).toBe("medium");
    expect(confidenceLabel(0.1)).toBe("low");
  });

  it("exercises analyzer filtering, timeout, metadata-only, still, and motion branches late in the suite", async () => {
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
      value: {
        frames: [makeEditorialFrame(), makeFrame(60, 72, LIGHT_RGB, 1)],
        outputWidth: 60,
        outputHeight: 72
      },
      limitations: []
    });

    const imageAnalysis = await analyzeInspiredesignMediaArtifacts([
      trustedImageInput,
      { ...trustedImageInput, referenceId: "diagnostic-pin", authority: "diagnostic" as const },
      { ...trustedImageInput, referenceId: "unscheduled-pin", scheduledForBundle: false }
    ], { generatedAt: "2026-06-06T00:00:00.000Z", ffprobe, ffmpeg });
    const gifAnalysis = await analyzeInspiredesignMediaArtifacts([
      { ...trustedImageInput, kind: "gif" as const, contentType: "image/gif", mediaPath: "pin-media-evidence/pin-media-coverage/main.gif" }
    ], { generatedAt: "2026-06-06T00:00:00.000Z", ffprobe, ffmpeg });
    const videoAnalysis = await analyzeInspiredesignMediaArtifacts([
      { ...trustedImageInput, kind: "video" as const, contentType: "video/mp4", mediaPath: "pin-media-evidence/pin-media-coverage/video.mp4" }
    ], { generatedAt: "2026-06-06T00:00:00.000Z", ffprobe, ffmpeg });
    const posterAnalysis = await analyzeInspiredesignMediaArtifacts([
      { ...trustedImageInput, kind: "video_poster" as const, contentType: "image/jpeg" }
    ], { generatedAt: "2026-06-06T00:00:00.000Z", ffprobe, ffmpeg });
    const metadataOnlyAnalysis = await analyzeInspiredesignMediaArtifacts([
      { ...trustedImageInput, width: undefined, height: undefined }
    ], {
      generatedAt: "2026-06-06T00:00:00.000Z",
      ffprobe: async () => ({ limitations: [] }),
      ffmpeg: async () => ({ limitations: [] })
    });

    expect(imageAnalysis.references).toHaveLength(1);
    expect(imageAnalysis.references[0]?.claimLevels).not.toContain("motion_sampled");
    expect(gifAnalysis.references[0]?.claimLevels).toContain("motion_sampled");
    expect(videoAnalysis.references[0]?.claimLevels).toContain("motion_sampled");
    expect(posterAnalysis.references[0]?.claimLevels).not.toContain("motion_sampled");
    const gifReference = gifAnalysis.references[0];
    expect(gifReference).toBeDefined();
    if (!gifReference) {
      throw new Error("expected GIF media-analysis reference");
    }
    const boardSummary = summarizeInspiredesignMediaReferenceForBoard(gifReference);
    expect(boardSummary.length).toBeGreaterThan(0);
    expect(boardSummary.join(" ")).toContain("sampled");
    expect(metadataOnlyAnalysis.references[0]?.facts.dimensions).toBeUndefined();
    expect(metadataOnlyAnalysis.references[0]?.claimLevels).toEqual(["metadata_only"]);
    expect(serializeInspiredesignMediaAnalysis(gifAnalysis)).not.toContain("\"data\":");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
    const frameExtractor = vi.fn<InspiredesignFfmpegFrameRunner>();
    try {
      const exhaustedAfterProbe = await analyzeInspiredesignMediaArtifacts([trustedImageInput], {
        generatedAt: "2026-06-06T00:00:00.000Z",
        timeoutMs: 10,
        ffprobe: async (_filePath, options) => {
          expect(options?.timeoutMs).toBe(10);
          vi.setSystemTime(new Date("2026-06-06T00:00:00.010Z"));
          return { value: { dimensions: { width: 800, height: 1080, aspectRatio: 0.7407 } }, limitations: [] };
        },
        ffmpeg: frameExtractor
      });

      expect(frameExtractor).not.toHaveBeenCalled();
      expect(exhaustedAfterProbe.references[0]?.limitations).toContain(
        "Media analysis stopped because the workflow timeout budget was exhausted."
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers media adapter process-error and degenerate-frame branches", async () => {
    const binaryDir = await mkdtemp(join(tmpdir(), "odb-media-analysis-eacces-"));
    try {
      const ffmpegError = await extractInspiredesignFfmpegFrames(trustedImageInput, { binaryPath: binaryDir });
      const ffprobeError = await runInspiredesignFfprobe(trustedImageInput.filePath, { binaryPath: binaryDir });
      const missingFfmpeg = await extractInspiredesignFfmpegFrames(trustedImageInput, {
        binaryPath: join(binaryDir, "missing-ffmpeg")
      });
      const missingFfprobe = await runInspiredesignFfprobe(trustedImageInput.filePath, {
        binaryPath: join(binaryDir, "missing-ffprobe")
      });
      const zeroWidthFrame = analyzeInspiredesignRgbFrame({
        width: 0,
        height: 1,
        data: new Uint8Array([DARK_RGB, DARK_RGB, DARK_RGB]),
        frameIndex: 0
      });
      const emptyTypography = analyzeInspiredesignTypographyStructure({
        width: 0,
        height: 0,
        data: new Uint8Array(),
        frameIndex: 0
      });

      expect(ffmpegError.limitations[0]).toContain("ffmpeg failed:");
      expect(ffprobeError.limitations[0]).toContain("ffprobe failed:");
      expect(missingFfmpeg.limitations[0]).toBe("ffmpeg binary was not found.");
      expect(missingFfprobe.limitations[0]).toBe("ffprobe binary was not found.");
      expect(zeroWidthFrame.layout.zones).toEqual([]);
      expect(emptyTypography.textRegionLayout.summary).toBe("No OCR-free text-like regions detected.");
    } finally {
      await rm(binaryDir, { recursive: true, force: true });
    }
  });

  it("covers Pinterest classification, site recipe, and pin-media authority branches", () => {
    const recipes = listSiteRecipes();
    const pinterestRecipe = recipes[0];
    expect(pinterestRecipe).toBeDefined();
    if (!pinterestRecipe) {
      throw new Error("expected Pinterest site recipe");
    }
    expect(Object.isFrozen(pinterestRecipe)).toBe(true);
    expect(resolveSiteRecipeForUrl("https://WWW.PINTEREST.COM/pin/61572719900827789/")?.id).toBe("social/pinterest");

    expect(classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "<img data-test-id=\"closeup-image\" src=\"pin.jpg\" />"
    })).toEqual(expect.objectContaining({ kind: "image_pin", sourcePageQuality: "pin_media" }));
    expect(classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "<video data-test-id=\"video\" src=\"pin.mp4\"></video>"
    })).toEqual(expect.objectContaining({ kind: "video_pin", sourcePageQuality: "pin_media" }));
    expect(resolvePinterestPrimaryCaptureStrategy([PINTEREST_PIN_URL], "off")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy([PINTEREST_PIN_URL], "deep")).toBe("source_diagnostic");

    const reference = trustedPinterestReference();
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ path: "pin-media-evidence/pin-media-coverage/main.jpeg" })]
    })).toBe(true);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({
        path: "pin-media-evidence/pin-media-coverage/main.png",
        contentType: "image/png",
        mediaUrl: "https://i.pinimg.com/originals/aa/bb/cc/example.png"
      })]
    })).toBe(true);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({
        path: "pin-media-evidence/pin-media-coverage/video.mp4",
        contentType: "video/mp4",
        kind: "video",
        mediaUrl: "https://v1.pinimg.com/videos/mc/720p/example.mp4"
      })]
    })).toBe(true);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ contentType: "image/png", kind: "video" })]
    })).toBe(false);
  });

  it("covers remaining reachable media timeout and metadata-only branches", async () => {
    const hangingBinary = await makeFakeNodeBinary("setInterval(() => undefined, 1000);");
    const frame = makeFrame(2, 2, LIGHT_RGB);
    try {
      const timedOut = await extractInspiredesignFfmpegFrames(trustedImageInput, {
        binaryPath: hangingBinary.binaryPath,
        timeoutMs: 1
      });
      const defaultTimedOut = await extractInspiredesignFfmpegFrames(trustedImageInput, {
        binaryPath: hangingBinary.binaryPath
      });
      const metadataOnlyWithPixels = await analyzeInspiredesignMediaArtifacts([
        { ...trustedImageInput, width: undefined, height: undefined }
      ], {
        generatedAt: "2026-06-06T00:00:00.000Z",
        ffprobe: async () => ({
          value: {
            durationSeconds: 3,
            fps: 24,
            frameCount: 72,
            hasAudio: false,
            containerFormat: "jpeg_pipe"
          },
          limitations: []
        }),
        ffmpeg: async () => ({
          value: { frames: [frame], outputWidth: frame.width, outputHeight: frame.height },
          limitations: []
        })
      });

      expect(timedOut.limitations[0]).toBe("ffmpeg timed out after 1ms.");
      expect(defaultTimedOut.limitations[0]).toBe("ffmpeg timed out after 5000ms.");
      expect(metadataOnlyWithPixels.references[0]?.claimLevels).toEqual(expect.arrayContaining([
        "metadata_only",
        "pixel_stats",
        "palette_quantized",
        "layout_heuristic"
      ]));
      expect(metadataOnlyWithPixels.references[0]?.facts.dimensions).toBeUndefined();
    } finally {
      await cleanupFakeBinary(hangingBinary.dir);
    }
  });

  it("covers visual policy and persisted visual evidence sanitization branches", () => {
    for (const reasonCode of ["policy_blocked", "auth_required", "challenge_detected", "rate_limited"] as const) {
      expect(decideInspiredesignVisualCapturePolicy({
        visualEvidence: "required",
        failures: [{
          provider: "web/default",
          source: "web",
          error: { code: reasonCode, message: reasonCode, reasonCode }
        }]
      })).toMatchObject({ status: "skipped", reason: reasonCode });
    }
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "required",
      failures: [{
        provider: "web/default",
        source: "web",
        error: { code: "ip", message: "IP blocked", reasonCode: "ip_blocked" }
      }]
    })).toMatchObject({ status: "allowed", reason: "visual_capture_allowed" });
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "required",
      hasUsableRecords: true,
      topLevelError: { code: "auth", message: "Auth required", reasonCode: "auth_required" }
    })).toMatchObject({ status: "allowed", reason: "visual_capture_allowed" });
    expect(decideInspiredesignVisualCapturePolicy({
      visualEvidence: "off",
      topLevelError: { code: "auth", message: "Auth required", reasonCode: "auth_required" }
    })).toMatchObject({ status: "skipped", reason: "visual_evidence_off" });

    expect(persistInspiredesignVisualEvidence({
      status: "captured",
      kind: "viewport",
      fullPage: false,
      capturedAt: "not a valid timestamp",
      artifactPath: "visual-evidence/pin-media-coverage/viewport.png",
      sha256: SHA_256_HEX,
      bytes: 4096,
      warnings: []
    }).capturedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("covers site recipe fallback and pin-media authority validation branches", () => {
    const reference = trustedPinterestReference();

    expect(resolveSiteRecipeForProvider("pinterest")).toEqual(expect.objectContaining({ id: "social/pinterest" }));
    expect(resolveSiteRecipeForProvider("unknown-provider")).toBeUndefined();
    expect(resolveSiteRecipeForUrl("not a url")).toBeUndefined();

    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ path: "pin-media-evidence/pin-media-coverage/poster.jpg", kind: "video_poster" })]
    })).toBe(true);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({
        path: "pin-media-evidence/pin-media-coverage/main.png",
        contentType: "image/png",
        mediaUrl: "https://i.pinimg.com/originals/aa/bb/cc/example.png"
      })]
    })).toBe(true);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({
        path: "pin-media-evidence/pin-media-coverage/video.mp4",
        kind: "video",
        contentType: "video/mp4",
        mediaUrl: "https://v.pinimg.com/videos/aa/bb/cc/example.mp4"
      })]
    })).toBe(true);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({
        path: "pin-media-evidence/pin-media-coverage/video.mp4",
        kind: "video",
        contentType: "image/jpeg",
        mediaUrl: "https://v.pinimg.com/videos/aa/bb/cc/example.mp4"
      })]
    })).toBe(false);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ path: "pin-media-evidence/pin-media-coverage/main.webp", contentType: "image/jpeg" })]
    })).toBe(false);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ contentType: "text/plain" })]
    })).toBe(false);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ path: "pin-media-evidence/other-reference/main.jpg" })]
    })).toBe(false);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ warnings: ["interface_chrome_shell"] })]
    })).toBe(true);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ contentType: undefined })]
    })).toBe(false);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ status: "captured", warnings: "login_or_challenge_state" })]
    })).toBe(false);
    expect(hasInspiredesignArtifactBackedEvidenceAuthority(reference, "pin_media_ready", {
      pinMedia: [makeTrustedPinMedia({ status: "captured", warnings: ["login_or_challenge_state", 7] })]
    })).toBe(false);

    expect(hasPinterestPinMediaAuthorityBlockingWarning(makeTrustedPinMedia({
      warnings: ["interface_chrome_shell"]
    }))).toBe(false);
    expect(hasPinterestPinMediaAuthorityBlockingWarning(makeTrustedPinMedia({
      warnings: ["login challenge overlay"]
    }))).toBe(true);
  });

  it("covers Pinterest source classification and reference-board evidence branches", () => {
    const loginClassification = classifyPinterestSourcePage([
      { url: PINTEREST_PIN_URL, html: "Log in to see more pins" }
    ]);
    const searchShellClassification = classifyPinterestSourcePage([
      { url: "https://www.pinterest.com/search/pins/?q=chairs", html: "Search results for chairs" }
    ]);
    const loginIdeaClassification = classifyPinterestCandidate({
      url: "https://www.pinterest.com/ideas/editorial-photography/",
      content: "Log in to continue"
    });
    const chromeShellClassification = classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "Save Follow More like this Related searches"
    });
    const loginPinClassification = classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "Log in to see more pins"
    });
    const imageClassification = classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "<img data-test-id=\"closeup-image\" src=\"pin.jpg\" />"
    });
    const videoClassification = classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "<video data-test-id=\"video\" src=\"pin.mp4\"></video>"
    });
    const gridOnlyPinClassification = classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "<div data-grid><div data-test-id=\"pinwrapper\"></div></div>"
    });
    const chromeOnlyClassification = classifyPinterestCandidate({
      url: "https://www.pinterest.com/search/pins/?q=chairs",
      content: "Your profile Updates Messages Settings & support Accounts"
    });

    expect(shouldBlockPinterestSourceExtraction(loginClassification)).toBe(true);
    expect(shouldBlockPinterestSourceExtraction(searchShellClassification)).toBe(true);
    expect(shouldBlockPinterestSourceExtraction(chromeShellClassification)).toBe(true);
    expect(loginPinClassification).toEqual(expect.objectContaining({
      kind: "login_challenge",
      sourcePageQuality: "login_challenge"
    }));
    expect(loginIdeaClassification).toEqual(expect.objectContaining({
      kind: "login_challenge",
      sourcePageQuality: "login_challenge"
    }));
    expect(classifyPinterestCandidate({
      url: PINTEREST_PIN_URL,
      html: "<img data-test-id=\"closeup-image\" src=\"pin.jpg\" />",
      allowPinMediaPageQuality: false
    })).toEqual(expect.objectContaining({
      kind: "image_pin",
      sourcePageQuality: "unknown"
    }));
    expect(gridOnlyPinClassification).toEqual(expect.objectContaining({
      kind: "unknown_pin",
      sourcePageQuality: "pin_grid_media",
      diagnosticBlockers: ["pin_media_type_unproven"]
    }));
    expect(chromeOnlyClassification).toEqual(expect.objectContaining({
      kind: "shell",
      sourcePageQuality: "chrome_only"
    }));
    expect(shouldBlockPinterestSourceExtraction(chromeOnlyClassification)).toBe(true);
    expect(summarizePinterestClassifications([
      imageClassification,
      videoClassification,
      classifyPinterestCandidate({ url: "https://www.pinterest.com/ideas/example/" }),
      classifyPinterestCandidate({ url: "https://www.pinterest.com/source/example.com/" }),
      classifyPinterestCandidate({ url: "https://example.com/not-pinterest" })
    ])).toEqual(expect.objectContaining({
      image_pin: 1,
      video_pin: 1,
      idea_page: 1,
      source_page: 1,
      invalid: 1
    }));

    expect(resolvePinterestPrimaryCaptureStrategy([], "deep")).toBe("deep_diagnostics");
    expect(resolvePinterestPrimaryCaptureStrategy([], "off")).toBe("capture_off");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://example.com/not-pinterest"], "deep")).toBe("deep_diagnostics");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://example.com/not-pinterest"], "off")).toBe("capture_off");
    expect(resolvePinterestPrimaryCaptureStrategy([PINTEREST_PIN_URL], "deep")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy([PINTEREST_PIN_URL], "off")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy([`${PINTEREST_PIN_URL}?image=1`], "deep")).toBe("source_diagnostic");
    expect(resolvePinterestPrimaryCaptureStrategy(["https://www.pinterest.com/pin/61572719900827789/?utm=image"], "off")).toBe("source_diagnostic");

    expect(hasInspiredesignUsableReferenceEvidence({
      id: "business-pin",
      url: "https://business.pinterest.com/pin/61572719900827789/",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: null
    })).toBe(false);
    expect(hasInspiredesignUsableReferenceEvidence({
      id: "example-captured",
      url: "https://example.com/reference",
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: { snapshot: { content: "Original editorial reference content with strong hierarchy" } }
    })).toBe(true);
    expect(hasInspiredesignUsableReferenceEvidence({
      id: "example-recovered",
      url: "https://example.com/recovered",
      title: "Log in required",
      fetchStatus: "failed",
      captureStatus: "captured",
      capture: { clone: { componentPreview: "Recovered creative hero composition", cssPreview: "" } }
    })).toBe(true);
    expect(hasInspiredesignUsableReferenceEvidence({
      id: "example-login-blocked",
      url: "https://example.com/login-blocked",
      title: "Log in required",
      fetchStatus: "failed",
      captureStatus: "captured",
      capture: { clone: { componentPreview: "", cssPreview: "" } }
    })).toBe(false);
    expect(hasInspiredesignUsableReferenceEvidence({
      id: "example-fetch-only",
      url: "https://example.com/fetch-only",
      title: "Editorial reference story",
      fetchStatus: "captured",
      captureStatus: "off",
      capture: null
    })).toBe(true);
    expect(hasInspiredesignUsableReferenceEvidence({
      id: "pin-snapshot",
      url: PINTEREST_PIN_URL,
      fetchStatus: "captured",
      captureStatus: "captured",
      capture: {
        visual: {
          status: "captured",
          sourceUrl: PINTEREST_PIN_URL,
          pinterestPageQuality: "pin_media",
          path: "visual-evidence/pin-snapshot/viewport.png",
          sha256: SHA_256_HEX,
          bytes: 4096,
          warnings: []
        }
      }
    })).toBe(true);
    expect(hasPinterestPinMediaBlockingWarning(["login_or_challenge_state"])).toBe(false);
  });

  it("covers reference-board pin-media index and media-analysis fallback branches", () => {
    const persistedPinMedia = makeReferenceBoardPinMedia();
    const posterPinMedia = persistInspiredesignPinterestPinMediaEvidence({
      status: "captured" as const,
      kind: "video_poster" as const,
      capturedAt: "2026-06-07T00:00:00.000Z",
      referenceId: "pin-media-coverage",
      url: PINTEREST_PIN_URL,
      sourceUrl: PINTEREST_PIN_URL,
      pinterestPageQuality: "pin_media" as const,
      mediaUrl: PIN_MEDIA_URL,
      width: 640,
      height: 640,
      contentType: "image/jpeg",
      warnings: [],
      rejectionReasons: []
    }, {
      artifactPath: "pin-media-evidence/pin-media-coverage/poster.jpg",
      buffer: makeJpegPinMediaBytes()
    });
    const pinMediaIndex = [{
      referenceId: "pin-media-coverage",
      url: PINTEREST_PIN_URL,
      sourceUrl: PINTEREST_PIN_URL,
      mediaUrl: PIN_MEDIA_URL,
      pinterestPageQuality: "pin_media" as const,
      path: persistedPinMedia.path ?? "pin-media-evidence/pin-media-coverage/main.jpg",
      sha256: persistedPinMedia.sha256 ?? SHA_256_HEX,
      bytes: persistedPinMedia.bytes ?? 4096,
      width: persistedPinMedia.width ?? 640,
      height: persistedPinMedia.height ?? 640,
      contentType: persistedPinMedia.contentType ?? "image/jpeg",
      kind: "image" as const,
      authority: "design_evidence" as const,
      capturedAt: "2026-06-07T00:00:00.000Z",
      warnings: [],
      firstPartyProvenance: persistedPinMedia.firstPartyProvenance
    }];
    const mediaAnalysis = {
      version: 1 as const,
      generatedAt: "2026-06-07T00:00:00.000Z",
      nonGoals: ["Readable exact text extraction is not part of v1."],
      references: [{
        referenceId: "pin-media-coverage",
        mediaPath: "pin-media-evidence/pin-media-coverage/main.jpg",
        sourceUrl: PINTEREST_PIN_URL,
        mediaUrl: PIN_MEDIA_URL,
        kind: "image" as const,
        contentType: "image/jpeg",
        bytes: persistedPinMedia.bytes ?? 4096,
        hash: persistedPinMedia.sha256 ?? SHA_256_HEX,
        dimensions: {
          width: persistedPinMedia.width ?? 640,
          height: persistedPinMedia.height ?? 640,
          aspectRatio: 1
        },
        authority: "design_evidence" as const,
        claimLevels: ["metadata_only", "pixel_stats"],
        facts: { dimensions: { width: 640, height: 640, aspectRatio: 1 } },
        designGuidance: {
          visualStrengths: ["Measured dark editorial media."],
          visualRisks: ["Exact readable text is unavailable."],
          layoutRecipe: "centered editorial composition",
          contentHierarchy: ["hero_headline_candidate"],
          componentFamilies: ["hero"],
          motionPosture: "Static source only.",
          tokenNotes: ["Use dark editorial contrast."],
          patternsToBorrow: ["centered editorial composition"],
          patternsToReject: ["generic card grid"],
          typographyPosture: "sparse editorial",
          imageryPosture: "dark dominant",
          confidence: 0.8
        },
        confidence: 0.8,
        limitations: []
      }]
    };
    const reference = {
      id: "pin-media-coverage",
      url: PINTEREST_PIN_URL,
      title: "Premium photography portfolio",
      fetchStatus: "captured" as const,
      captureStatus: "captured" as const,
      capture: { pinMedia: persistedPinMedia }
    };
    const posterPinMediaIndex = [{
      referenceId: "pin-media-coverage",
      url: PINTEREST_PIN_URL,
      sourceUrl: PINTEREST_PIN_URL,
      mediaUrl: PIN_MEDIA_URL,
      pinterestPageQuality: "pin_media" as const,
      path: posterPinMedia.path ?? "pin-media-evidence/pin-media-coverage/poster.jpg",
      sha256: posterPinMedia.sha256 ?? SHA_256_HEX,
      bytes: posterPinMedia.bytes ?? 4096,
      width: posterPinMedia.width ?? 640,
      height: posterPinMedia.height ?? 640,
      contentType: posterPinMedia.contentType ?? "image/jpeg",
      kind: "video_poster" as const,
      authority: "design_evidence" as const,
      capturedAt: "2026-06-07T00:00:00.000Z",
      warnings: [],
      firstPartyProvenance: posterPinMedia.firstPartyProvenance
    }];
    const board = buildInspiredesignReferencePatternBoard(
      "coverage-pin-media-board",
      minimalBriefFormat,
      [reference],
      "Premium photography portfolio",
      mediaAnalysis,
      pinMediaIndex
    );
    const posterBoard = buildInspiredesignReferencePatternBoard(
      "coverage-pin-media-poster-board",
      minimalBriefFormat,
      [{
        ...reference,
        capture: { pinMedia: posterPinMedia }
      }],
      "Premium photography portfolio",
      undefined,
      posterPinMediaIndex
    );
    const snapshotFallbackBoard = buildInspiredesignReferencePatternBoard(
      "coverage-pin-media-board-no-index",
      minimalBriefFormat,
      [{
        ...reference,
        capture: {
          pinMedia: persistedPinMedia,
          visual: {
            status: "captured" as const,
            sourceUrl: PINTEREST_PIN_URL,
            pinterestPageQuality: "pin_media" as const,
            path: "visual-evidence/pin-media-coverage/viewport.png",
            sha256: SHA_256_HEX,
            bytes: 4096,
            warnings: []
          }
        }
      }],
      "Premium photography portfolio",
      mediaAnalysis
    );
    const rankedReferenceBoard = buildInspiredesignReferencePatternBoard(
      "coverage-ranked-reference-board",
      minimalBriefFormat,
      [{
        id: "ranked-reference",
        url: "https://example.com/editorial-photography-case-study",
        title: "Premium photography portfolio launch landing page hero narrative case study",
        excerpt: "Editorial photography landing page with strong hero hierarchy, launch narrative, proof sections, and conversion CTA.",
        fetchStatus: "captured" as const,
        captureStatus: "off" as const,
        capture: null
      }],
      "Premium photography portfolio launch landing page"
    );
    const limitedReferenceBoard = buildInspiredesignReferencePatternBoard(
      "coverage-limited-reference-board",
      minimalBriefFormat,
      [{
        id: "limited-reference",
        url: "https://example.com/minimal-reference",
        title: "Premium still life",
        fetchStatus: "captured" as const,
        captureStatus: "off" as const,
        capture: null
      }],
      "Premium photography portfolio launch landing page"
    );

    expect(board.references[0]?.mediaAnalysisBacked).toBe(true);
    expect(board.references[0]?.mediaAnalysisSource?.sourceUrl).toBe(PINTEREST_PIN_URL);
    expect(posterBoard.references[0]?.capturedVia).toContain("pin_media_ready");
    expect(rankedReferenceBoard.references[0]?.evidenceAuthority).toBe("ranked_reference");
    expect(limitedReferenceBoard.references[0]?.selectionReason).toContain("limited but usable reference cues");
    expect(snapshotFallbackBoard.references[0]?.mediaAnalysisBacked).toBeUndefined();
  });

  it("covers primary pin-media capture metadata fallback branches", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-primary-pin-media-coverage-"));
    try {
      const requestedPath = join(root, "pin-media", "main.jpg");
      const mismatchedPath = join(root, "pin-media", "other.jpg");
      const mismatch = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        makePrimaryPinMediaCaptureManager({
          status: "captured",
          kind: "video",
          path: mismatchedPath,
          sourceUrl: PINTEREST_PIN_URL,
          warnings: ["candidate_checked"]
        }),
        PINTEREST_PIN_URL,
        {
          referenceId: "pin-media-coverage",
          pinMediaEvidencePath: requestedPath,
          browserMode: "managed",
          cookiePolicyOverride: "off",
          pinterestPageQuality: "pin_media",
          timeoutMs: 5000
        }
      );
      const notFound = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        makePrimaryPinMediaCaptureManager(
          {
            status: "not_found",
            warnings: ["no_candidate"],
            rejectedCandidates: [{ reasons: ["pin_media_not_found"] }]
          },
          { url: "https://example.com/not-pinterest", title: "Example", content: "", warnings: [] }
        ),
        PINTEREST_PIN_URL,
        {
          referenceId: "pin-media-coverage",
          pinMediaEvidencePath: requestedPath,
          browserMode: "managed",
          cookiePolicyOverride: "off",
          pinterestPageQuality: "pin_media",
          timeoutMs: 5000
        }
      );
      const fallbackMismatch = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        makePrimaryPinMediaCaptureManager(
          {
            status: "captured",
            path: mismatchedPath,
            warnings: []
          },
          { url: "https://example.com/not-pinterest", title: "Example", content: "", warnings: [] }
        ),
        PINTEREST_PIN_URL,
        {
          referenceId: "pin-media-coverage",
          pinMediaEvidencePath: requestedPath,
          browserMode: "managed",
          cookiePolicyOverride: "off",
          pinterestPageQuality: "pin_media",
          timeoutMs: 5000
        }
      );
      const timeoutLimitedViewport = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        {
          ...makePrimaryPinMediaCaptureManager(
            {
              status: "not_found",
              warnings: [],
              rejectedCandidates: [{ reasons: ["pin_media_not_found"] }]
            },
            { url: PINTEREST_PIN_URL, title: "Pinterest pin", content: "" }
          ),
          clonePageHtmlWithOptions: async () => {
            throw new Error("timeout-limited viewport HTML should not be captured");
          }
        } as PrimaryPinMediaCaptureManager,
        PINTEREST_PIN_URL,
        {
          referenceId: "pin-media-coverage",
          pinMediaEvidencePath: requestedPath,
          browserMode: "managed",
          cookiePolicyOverride: "off",
          pinterestPageQuality: "pin_media",
          timeoutMs: 1
        }
      );
      const warmupFailure = await captureInspiredesignPrimaryPinMediaEvidenceFromManager(
        {
          ...makePrimaryPinMediaCaptureManager({ status: "not_found", warnings: [], rejectedCandidates: [] }),
          waitForLoad: async () => {
            throw new Error("non ignorable network idle failure");
          }
        } as PrimaryPinMediaCaptureManager,
        PINTEREST_PIN_URL,
        {
          referenceId: "pin-media-coverage",
          pinMediaEvidencePath: requestedPath,
          browserMode: "extension",
          cookiePolicyOverride: "off",
          pinterestPageQuality: "pin_media",
          timeoutMs: 5000
        }
      );

      expect(mismatch).toEqual(expect.objectContaining({
        status: "failed",
        kind: "video",
        sourceUrl: PINTEREST_PIN_URL,
        pinterestPageQuality: "unknown",
        rejectionReasons: ["pin_media_temp_path_mismatch"]
      }));
      expect(notFound).toEqual(expect.objectContaining({
        status: "skipped",
        pinterestPageQuality: "pin_media",
        warnings: ["no_candidate"],
        rejectionReasons: ["pin_media_not_found"]
      }));
      expect(fallbackMismatch).toEqual(expect.objectContaining({
        status: "failed",
        kind: "image",
        pinterestPageQuality: "pin_media",
        rejectionReasons: ["pin_media_temp_path_mismatch"]
      }));
      expect(timeoutLimitedViewport).toEqual(expect.objectContaining({
        status: "skipped",
        pinterestPageQuality: "unknown",
        rejectionReasons: ["pin_media_not_found"]
      }));
      expect(warmupFailure).toEqual(expect.objectContaining({
        status: "failed",
        rejectionReasons: ["primary_capture_setup_failed"]
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("covers primary motion capture metadata source branches", async () => {
    const motion = await captureInspiredesignPrimaryMotionEvidenceFromManager(
      makePrimaryMotionCaptureManager(),
      PINTEREST_PIN_URL,
      {
        outputDir: "/tmp/odb-motion",
        browserMode: "managed",
        cookiePolicyOverride: "off",
        timeoutMs: 5000
      }
    );

    expect(motion).toEqual(expect.objectContaining({
      status: "captured",
      kind: "screencast",
      sourceUrl: PINTEREST_PIN_URL,
      startedSourceUrl: PINTEREST_PIN_URL,
      endedSourceUrl: PINTEREST_PIN_URL,
      pinterestPageQuality: "pin_media",
      startedPinterestPageQuality: "pin_media",
      endedPinterestPageQuality: "pin_media",
      diagnostic: false,
      diagnosticReasons: []
    }));

    const noSourceMotion = await captureInspiredesignPrimaryMotionEvidenceFromManager(
      makePrimaryMotionCaptureManager({ title: "No source", content: "No URL available" }),
      PINTEREST_PIN_URL,
      {
        outputDir: "/tmp/odb-motion",
        browserMode: "managed",
        cookiePolicyOverride: "off",
        timeoutMs: 5000
      }
    );
    const nonHttpSourceMotion = await captureInspiredesignPrimaryMotionEvidenceFromManager(
      makePrimaryMotionCaptureManager({ url: "file:///tmp/local-pin.html", title: "Local", content: "Local capture" }),
      PINTEREST_PIN_URL,
      {
        outputDir: "/tmp/odb-motion",
        browserMode: "managed",
        cookiePolicyOverride: "off",
        timeoutMs: 5000
      }
    );

    expect(noSourceMotion).toEqual(expect.objectContaining({
      status: "captured",
      kind: "screencast",
      diagnostic: true,
      diagnosticReasons: ["motion_source_unverified"]
    }));
    expect(noSourceMotion).not.toHaveProperty("sourceUrl");
    expect(noSourceMotion).not.toHaveProperty("startedSourceUrl");
    expect(noSourceMotion).not.toHaveProperty("endedSourceUrl");
    expect(nonHttpSourceMotion).toEqual(expect.objectContaining({
      status: "captured",
      sourceUrl: "file:///tmp/local-pin.html",
      diagnostic: true,
      diagnosticReasons: ["motion_source_unverified"]
    }));
  });

  it("covers MP4 byte-inspection variants used by pin-media evidence", () => {
    const versionOneMp4 = inspectPinterestPinMediaBuffer(makeNestedMp4Bytes(makeMp4TkhdPayload(1, 540, 960)));
    const zeroDimensionMp4 = inspectPinterestPinMediaBuffer(makeNestedMp4Bytes(makeMp4TkhdPayload(0, 0, 960)));
    const unsupportedTkhdVersionMp4 = inspectPinterestPinMediaBuffer(makeNestedMp4Bytes(makeMp4TkhdPayload(2, 540, 960)));
    const malformedSmallBoxMp4 = inspectPinterestPinMediaBuffer(makeMalformedNestedMp4Bytes(4));
    const extendedSizeBoxMp4 = inspectPinterestPinMediaBuffer(makeMalformedNestedMp4Bytes(1));
    const oversizedChildBoxMp4 = inspectPinterestPinMediaBuffer(makeMalformedNestedMp4Bytes(500));
    const shortTkhdPayloadMp4 = inspectPinterestPinMediaBuffer(makeNestedMp4Bytes(Buffer.alloc(4, 0)));

    expect(versionOneMp4).toMatchObject({
      contentType: "video/mp4",
      extension: "mp4",
      width: 540,
      height: 960,
      reasons: []
    });
    expect(zeroDimensionMp4).toMatchObject({
      contentType: "video/mp4",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });
    expect(unsupportedTkhdVersionMp4).toMatchObject({
      contentType: "video/mp4",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });
    expect(malformedSmallBoxMp4).toMatchObject({
      contentType: "video/mp4",
      reasons: expect.arrayContaining(["missing_dimensions"])
    });
    expect(extendedSizeBoxMp4.reasons).toEqual(expect.arrayContaining(["missing_dimensions"]));
    expect(oversizedChildBoxMp4.reasons).toEqual(expect.arrayContaining(["missing_dimensions"]));
    expect(shortTkhdPayloadMp4.reasons).toEqual(expect.arrayContaining(["missing_dimensions"]));
  });
});
