import {
  extractInspiredesignFfmpegFrames,
  runInspiredesignFfmpegSceneDetection,
  type InspiredesignFfmpegFrameRunner,
  type InspiredesignFfmpegSceneRunner
} from "./ffmpeg";
import { runInspiredesignFfprobe, type InspiredesignFfprobeRunner } from "./ffprobe";
import { buildEmptyInspiredesignMediaDesignGuidance, buildInspiredesignMediaDesignGuidance } from "./design-guidance";
import { analyzeInspiredesignRgbFrame, buildInspiredesignMotionFacts } from "./pixel";
import { analyzeInspiredesignTypographyStructure } from "./typography-structure";
import {
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SERIALIZED_REFERENCES,
  INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS,
  INSPIREDESIGN_MEDIA_ANALYSIS_VERSION,
  type InspiredesignMediaAdapterResult,
  type InspiredesignMediaAnalysis,
  type InspiredesignMediaAnalysisInput,
  type InspiredesignMediaAnalysisReference,
  type InspiredesignMediaClaimLevel,
  type InspiredesignMediaDimensions,
  type InspiredesignMediaFacts,
  type InspiredesignMediaMetadataFacts,
  type InspiredesignMediaMotionSceneSummary,
  type InspiredesignRgbFrame
} from "./types";

export type InspiredesignMediaAnalyzerOptions = {
  generatedAt?: string;
  timeoutMs?: number;
  ffprobe?: InspiredesignFfprobeRunner;
  ffmpeg?: InspiredesignFfmpegFrameRunner;
  ffmpegScene?: InspiredesignFfmpegSceneRunner;
  ffprobeBinaryPath?: string;
  ffmpegBinaryPath?: string;
  ffprobeUnavailableLimitation?: string;
  ffmpegUnavailableLimitation?: string;
};

const EXACT_TEXT_LIMITATION = "Readable exact text extraction was not performed, so exact copy strings are unavailable.";
const STATIC_IMAGE_LIMITATION = "Static image does not prove real hover states or animation.";
const FONT_LIMITATION = "Exact font family cannot be proven from pixels alone.";
const TIMEOUT_BUDGET_EXHAUSTED_LIMITATION = "Media analysis stopped because the workflow timeout budget was exhausted.";
const TRUSTED_AUTHORITY = "design_evidence";
export const INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT = "1970-01-01T00:00:00.000Z";

export const analyzeInspiredesignMediaArtifacts = async (
  inputs: readonly InspiredesignMediaAnalysisInput[],
  options: InspiredesignMediaAnalyzerOptions = {}
): Promise<InspiredesignMediaAnalysis> => {
  const references: InspiredesignMediaAnalysisReference[] = [];
  const budget = createAnalysisBudget(options.timeoutMs);
  for (const input of trustedInputs(inputs)) {
    references.push(await analyzeTrustedInput(input, options, budget));
  }
  return {
    version: INSPIREDESIGN_MEDIA_ANALYSIS_VERSION,
    generatedAt: options.generatedAt ?? INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT,
    nonGoals: INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS,
    references
  };
};

export const isInspiredesignTrustedMediaAnalysisInput = (input: InspiredesignMediaAnalysisInput): boolean =>
  input.authority === TRUSTED_AUTHORITY && input.scheduledForBundle;

const trustedInputs = (inputs: readonly InspiredesignMediaAnalysisInput[]): InspiredesignMediaAnalysisInput[] =>
  inputs.filter(isInspiredesignTrustedMediaAnalysisInput).slice(0, INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SERIALIZED_REFERENCES);

const analyzeTrustedInput = async (
  input: InspiredesignMediaAnalysisInput,
  options: InspiredesignMediaAnalyzerOptions,
  budget: AnalysisBudget
): Promise<InspiredesignMediaAnalysisReference> => {
  if (isBudgetExhausted(budget)) {
    return buildReference(input, mergeMetadata(input), [], [TIMEOUT_BUDGET_EXHAUSTED_LIMITATION]);
  }
  const probeTimeoutMs = processTimeoutMs(budget);
  const probe = await runProbe(input.filePath, options, timeoutOptions(probeTimeoutMs));
  const metadata = mergeMetadata(input, probe.value);
  if (isBudgetExhausted(budget)) {
    return buildReference(input, metadata, [], [...probe.limitations, TIMEOUT_BUDGET_EXHAUSTED_LIMITATION]);
  }
  const frameTimeoutMs = processTimeoutMs(budget);
  const frameResult = await runFrameExtraction(input, options, {
    metadata,
    ...timeoutOptions(frameTimeoutMs)
  });
  const sceneResult = await runSceneDetection(input, options, metadata, timeoutOptions(processTimeoutMs(budget)));
  const limitations = buildBaseLimitations(input, probe, frameResult, sceneResult);
  return buildReference(input, metadata, frameResult.value?.frames ?? [], limitations, sceneResult.value);
};

const runProbe = (
  filePath: string,
  options: InspiredesignMediaAnalyzerOptions,
  timeout: { timeoutMs?: number }
): Promise<InspiredesignMediaAdapterResult<InspiredesignMediaMetadataFacts>> => {
  if (options.ffprobeUnavailableLimitation) {
    return Promise.resolve({ limitations: [options.ffprobeUnavailableLimitation] });
  }
  return (options.ffprobe ?? runInspiredesignFfprobe)(filePath, {
    ...timeout,
    ...(options.ffprobeBinaryPath ? { binaryPath: options.ffprobeBinaryPath } : {})
  });
};

const runFrameExtraction = (
  input: InspiredesignMediaAnalysisInput,
  options: InspiredesignMediaAnalyzerOptions,
  runOptions: Parameters<InspiredesignFfmpegFrameRunner>[1]
): Promise<InspiredesignMediaAdapterResult<{ frames: InspiredesignRgbFrame[] }>> => {
  if (options.ffmpegUnavailableLimitation) {
    return Promise.resolve({ limitations: [options.ffmpegUnavailableLimitation] });
  }
  return (options.ffmpeg ?? extractInspiredesignFfmpegFrames)(input, {
    ...runOptions,
    ...(options.ffmpegBinaryPath ? { binaryPath: options.ffmpegBinaryPath } : {})
  });
};

const buildReference = (
  input: InspiredesignMediaAnalysisInput,
  metadata: InspiredesignMediaMetadataFacts,
  frames: readonly InspiredesignRgbFrame[],
  limitations: readonly string[],
  sceneSummary?: InspiredesignMediaMotionSceneSummary
): InspiredesignMediaAnalysisReference => {
  const uniqueLimitations = [...new Set(limitations)];
  const facts = buildFacts(input, metadata, frames, sceneSummary);
  const claimLevels = buildClaimLevels(facts, input.kind);
  const confidence = calculateConfidence(claimLevels, uniqueLimitations);
  const designGuidance = claimLevels.length > 1
    ? buildInspiredesignMediaDesignGuidance({ facts, kind: input.kind, limitations: uniqueLimitations, confidence })
    : buildEmptyInspiredesignMediaDesignGuidance(uniqueLimitations);
  return {
    referenceId: input.referenceId,
    mediaPath: input.mediaPath,
    sourceUrl: input.sourceUrl,
    mediaUrl: input.mediaUrl,
    kind: input.kind,
    contentType: input.contentType,
    bytes: input.bytes,
    hash: input.hash,
    dimensions: facts.dimensions,
    authority: input.authority,
    claimLevels,
    facts,
    designGuidance,
    confidence,
    limitations: uniqueLimitations
  };
};

const buildFacts = (
  input: InspiredesignMediaAnalysisInput,
  metadata: InspiredesignMediaMetadataFacts,
  frames: readonly InspiredesignRgbFrame[],
  sceneSummary?: InspiredesignMediaMotionSceneSummary
): InspiredesignMediaFacts => {
  const dimensions = metadata.dimensions ?? inputDimensions(input);
  if (frames.length === 0) {
    return { metadata, dimensions };
  }
  const primaryAnalysis = analyzeInspiredesignRgbFrame(frames[0] as InspiredesignRgbFrame);
  return {
    metadata,
    dimensions,
    tone: primaryAnalysis.tone,
    palette: primaryAnalysis.palette,
    layout: primaryAnalysis.layout,
    typographyStructure: analyzeInspiredesignTypographyStructure(frames[0] as InspiredesignRgbFrame),
    motion: buildMotionFacts(input, metadata, frames, sceneSummary)
  };
};

const buildMotionFacts = (
  input: Pick<InspiredesignMediaAnalysisInput, "kind">,
  metadata: InspiredesignMediaMetadataFacts,
  frames: readonly InspiredesignRgbFrame[],
  sceneSummary?: InspiredesignMediaMotionSceneSummary
) => {
  if (input.kind === "image" || input.kind === "video_poster") {
    return undefined;
  }
  return buildInspiredesignMotionFacts(frames, metadata.fps, sceneSummary);
};

const runSceneDetection = (
  input: InspiredesignMediaAnalysisInput,
  options: InspiredesignMediaAnalyzerOptions,
  metadata: InspiredesignMediaMetadataFacts,
  timeout: { timeoutMs?: number }
): Promise<InspiredesignMediaAdapterResult<InspiredesignMediaMotionSceneSummary>> => {
  if (input.kind !== "gif" && input.kind !== "video") {
    return Promise.resolve({ limitations: [] });
  }
  if (options.ffmpegUnavailableLimitation) {
    return Promise.resolve({ limitations: [options.ffmpegUnavailableLimitation] });
  }
  return (options.ffmpegScene ?? runInspiredesignFfmpegSceneDetection)(input.filePath, {
    ...timeout,
    metadata,
    ...(options.ffmpegBinaryPath ? { binaryPath: options.ffmpegBinaryPath } : {})
  });
};

const buildBaseLimitations = (
  input: Pick<InspiredesignMediaAnalysisInput, "kind">,
  probe: InspiredesignMediaAdapterResult<InspiredesignMediaMetadataFacts>,
  frameResult: InspiredesignMediaAdapterResult<{ frames: InspiredesignRgbFrame[] }>,
  sceneResult: InspiredesignMediaAdapterResult<InspiredesignMediaMotionSceneSummary>
): string[] => {
  const limitations = [...probe.limitations, ...frameResult.limitations, ...sceneResult.limitations, EXACT_TEXT_LIMITATION, FONT_LIMITATION];
  if (input.kind === "image" || input.kind === "video_poster") {
    limitations.push(STATIC_IMAGE_LIMITATION);
  }
  return [...new Set(limitations)];
};

const buildClaimLevels = (facts: InspiredesignMediaFacts, kind: InspiredesignMediaAnalysisInput["kind"]): InspiredesignMediaClaimLevel[] => {
  const claimLevels: InspiredesignMediaClaimLevel[] = ["metadata_only"];
  if (facts.tone) {
    claimLevels.push("pixel_stats");
  }
  if (facts.palette?.length) {
    claimLevels.push("palette_quantized");
  }
  if (facts.layout) {
    claimLevels.push("layout_heuristic");
  }
  if (facts.typographyStructure) {
    claimLevels.push("typography_structure", "text_region_layout");
  }
  if ((kind === "gif" || kind === "video") && facts.motion && facts.motion.sampledFrameCount > 1) {
    claimLevels.push("motion_sampled");
  }
  return claimLevels;
};

const mergeMetadata = (
  input: Pick<InspiredesignMediaAnalysisInput, "kind" | "width" | "height">,
  metadata?: InspiredesignMediaMetadataFacts
): InspiredesignMediaMetadataFacts => {
  const merged: InspiredesignMediaMetadataFacts = { ...metadata };
  if (!merged.dimensions) {
    const dimensions = inputDimensions(input);
    if (dimensions) {
      merged.dimensions = dimensions;
    }
  }
  return merged;
};

type AnalysisBudget = {
  deadlineMs?: number;
};

const createAnalysisBudget = (timeoutMs?: number): AnalysisBudget => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return {};
  }
  return { deadlineMs: Date.now() + Math.max(0, timeoutMs) };
};

const isBudgetExhausted = (budget: AnalysisBudget): boolean => (
  typeof budget.deadlineMs === "number" && Date.now() >= budget.deadlineMs
);

const processTimeoutMs = (budget: AnalysisBudget): number | undefined => {
  if (typeof budget.deadlineMs !== "number") {
    return undefined;
  }
  return Math.max(1, budget.deadlineMs - Date.now());
};

const timeoutOptions = (timeoutMs: number | undefined): { timeoutMs?: number } => (
  typeof timeoutMs === "number" ? { timeoutMs } : {}
);

const inputDimensions = (input: Pick<InspiredesignMediaAnalysisInput, "width" | "height">): InspiredesignMediaDimensions | undefined => {
  if ("kind" in input && input.kind === "video") {
    return undefined;
  }
  if (!input.width || !input.height) {
    return undefined;
  }
  return { width: input.width, height: input.height, aspectRatio: round(input.width / input.height) };
};

const calculateConfidence = (claimLevels: readonly InspiredesignMediaClaimLevel[], limitations: readonly string[]): number => {
  const baseConfidence = Math.min(0.92, 0.18 + claimLevels.length * 0.13);
  const limitationPenalty = Math.min(0.28, limitations.length * 0.025);
  return round(Math.max(0, baseConfidence - limitationPenalty));
};

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
