export const INSPIREDESIGN_MEDIA_ANALYSIS_VERSION = 1;
export const INSPIREDESIGN_MEDIA_ANALYSIS_PROCESS_TIMEOUT_MS = 5_000;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PROCESS_OUTPUT_BYTES = 8_000_000;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_WIDTH = 160;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_DECODED_FRAME_HEIGHT = 160;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES = 8;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MIN_TEMPORAL_SAMPLE_DURATION_SECONDS = 1;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SERIALIZED_REFERENCES = 24;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_PALETTE_SWATCHES = 8;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_LAYOUT_ZONES = 8;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_TEXT_REGIONS = 12;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_GUIDANCE_ENTRIES = 8;
export const INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS = 2_500;
export const INSPIREDESIGN_MEDIA_ANALYSIS_MAX_BINARY_PROBE_OUTPUT_BYTES = 64_000;
export const OPENDEVBROWSER_FFMPEG_PATH_ENV = "OPENDEVBROWSER_FFMPEG_PATH";
export const OPENDEVBROWSER_FFPROBE_PATH_ENV = "OPENDEVBROWSER_FFPROBE_PATH";

export const INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS = [
  "Sharp image decoding is not part of v1.",
  "Tesseract.js and native Tesseract OCR are not part of v1.",
  "OpenCV.js is not part of v1.",
  "Browser canvas pixel extraction is not part of v1.",
  "Model vision and model-described media claims are not part of v1.",
  "Readable exact text extraction is not part of v1.",
  "media-analysis.json cannot satisfy product readiness."
] as const;

export type InspiredesignMediaKind = "image" | "gif" | "video" | "video_poster";
export type InspiredesignMediaAuthority = "design_evidence" | "diagnostic";

export type InspiredesignMediaAnalysisBinaryPathsConfig = {
  ffmpegPath?: string;
  ffprobePath?: string;
};

export type InspiredesignMediaAnalysisBinaryTool = "ffmpeg" | "ffprobe";
export type InspiredesignMediaAnalysisBinarySource = "env" | "config" | "path";
export type InspiredesignMediaAnalysisBinaryCapabilityTier =
  | "frame_decode"
  | "metadata_probe"
  | "unavailable";

export type InspiredesignMediaAnalysisHostCapabilityTier =
  | "full"
  | "metadata_only"
  | "frame_decode_only"
  | "unavailable";

export type InspiredesignMediaAnalysisBinaryStatus = {
  tool: InspiredesignMediaAnalysisBinaryTool;
  available: boolean;
  source: InspiredesignMediaAnalysisBinarySource;
  requestedPath: string;
  resolvedPath?: string;
  version?: string;
  limitation?: string;
  capabilityTier: InspiredesignMediaAnalysisBinaryCapabilityTier;
};

export type InspiredesignMediaAnalysisBinaryResolution = {
  available: boolean;
  capabilityTier: InspiredesignMediaAnalysisHostCapabilityTier;
  ffmpeg: InspiredesignMediaAnalysisBinaryStatus;
  ffprobe: InspiredesignMediaAnalysisBinaryStatus;
  limitations: string[];
};

export type InspiredesignMediaClaimLevel =
  | "metadata_only"
  | "pixel_stats"
  | "palette_quantized"
  | "layout_heuristic"
  | "typography_structure"
  | "text_region_layout"
  | "motion_sampled";

export type InspiredesignMediaDimensions = {
  width: number;
  height: number;
  aspectRatio: number;
};

export type InspiredesignMediaMetadataFacts = {
  dimensions?: InspiredesignMediaDimensions;
  durationSeconds?: number;
  fps?: number;
  frameCount?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio?: boolean;
  containerFormat?: string;
};

export type InspiredesignMediaToneFacts = {
  meanLuminance: number;
  luminanceStandardDeviation: number;
  darkCoverage: number;
  brightCoverage: number;
  midtoneCoverage: number;
  contrastPosture: "low" | "moderate" | "high";
  densityPosture: "sparse" | "balanced" | "dense";
  edgeDensity: number;
};

export type InspiredesignMediaPaletteSwatch = {
  hex: string;
  coverage: number;
  roleHint: "background" | "foreground" | "accent" | "muted foreground" | "surface";
};

export type InspiredesignMediaLayoutZone = {
  role:
    | "hero_copy"
    | "hero_media"
    | "portfolio_grid"
    | "caption_row"
    | "navigation"
    | "cta_cluster"
    | "focal_region"
    | "negative_space";
  bboxNorm: [number, number, number, number];
  confidence: number;
};

export type InspiredesignMediaLayoutFacts = {
  composition:
    | "centered editorial composition"
    | "left-weighted split hero"
    | "right-weighted split hero"
    | "upper hero with lower grid"
    | "dense grid composition"
    | "balanced poster composition";
  whitespaceCoverage: number;
  focalRegions: InspiredesignMediaLayoutZone[];
  zones: InspiredesignMediaLayoutZone[];
};

export type InspiredesignMediaTextRegionRole =
  | "nav_row_candidate"
  | "hero_headline_candidate"
  | "support_copy_candidate"
  | "cta_cluster_candidate"
  | "portfolio_caption_repetition"
  | "card_label_candidate"
  | "text_region_candidate";

export type InspiredesignMediaTextRegion = {
  role: InspiredesignMediaTextRegionRole;
  bboxNorm: [number, number, number, number];
  scale: "small" | "medium" | "large";
  contrast: "muted" | "high";
  alignment: "left" | "center" | "right";
  confidence: number;
};

export type InspiredesignMediaTypographyStructureFacts = {
  readableTextAvailable: false;
  posture: string;
  regions: InspiredesignMediaTextRegion[];
  textRegionLayout: {
    summary: string;
    regionCount: number;
    repeatedRegionCount: number;
    dominantAlignment: "left" | "center" | "right";
  };
};

export type InspiredesignMediaFrameToneSummary = {
  frameIndex: number;
  meanLuminance: number;
  darkCoverage: number;
  brightCoverage: number;
};

export type InspiredesignMediaMotionRegionDelta = {
  row: number;
  column: number;
  bboxNorm: [number, number, number, number];
  averageDelta: number;
  peakDelta: number;
};

export type InspiredesignMediaMotionFamily =
  | "static_hold"
  | "subtle_loop"
  | "fade_or_exposure_shift"
  | "cut_or_scene_change"
  | "dynamic_motion";

export type InspiredesignMediaMotionSceneSummary = {
  detector: "ffmpeg_scdet";
  eventCount: number;
  strongestScore: number;
  timestampsSeconds: number[];
  limitations: string[];
};

export type InspiredesignMediaMotionSignature = {
  version: 1;
  sampleBasis: "decoded_rgb_frames";
  motionFamily: InspiredesignMediaMotionFamily;
  peakFrameDelta: number;
  averageFrameDelta: number;
  deltaVariance: number;
  toneShift: number;
  dominantChangedRegions: InspiredesignMediaMotionRegionDelta[];
  confidence: number;
  sceneSummary?: InspiredesignMediaMotionSceneSummary;
};

export type InspiredesignMediaMotionFacts = {
  sampledFrameCount: number;
  sampledFrameIndexes: number[];
  frameDeltas: number[];
  averageFrameDelta: number;
  cadence: "static" | "slow" | "moderate" | "fast";
  posture: "static_source_adaptation" | "stable_loop" | "subtle_motion" | "dynamic_motion";
  frameToneSummaries: InspiredesignMediaFrameToneSummary[];
  motionSignature?: InspiredesignMediaMotionSignature;
};

export type InspiredesignMediaFacts = {
  metadata?: InspiredesignMediaMetadataFacts;
  dimensions?: InspiredesignMediaDimensions;
  tone?: InspiredesignMediaToneFacts;
  palette?: InspiredesignMediaPaletteSwatch[];
  layout?: InspiredesignMediaLayoutFacts;
  typographyStructure?: InspiredesignMediaTypographyStructureFacts;
  motion?: InspiredesignMediaMotionFacts;
};

export type InspiredesignMediaDesignGuidance = {
  visualStrengths: string[];
  visualRisks: string[];
  layoutRecipe: string;
  contentHierarchy: string[];
  componentFamilies: string[];
  motionPosture: string;
  tokenNotes: string[];
  patternsToBorrow: string[];
  patternsToReject: string[];
  typographyPosture: string;
  imageryPosture: string;
  confidence: number;
};

export type InspiredesignMediaAnalysisReference = {
  referenceId: string;
  mediaPath: string;
  sourceUrl?: string;
  mediaUrl?: string;
  kind: InspiredesignMediaKind;
  contentType?: string;
  bytes?: number;
  hash?: string;
  dimensions?: InspiredesignMediaDimensions;
  authority: InspiredesignMediaAuthority;
  claimLevels: InspiredesignMediaClaimLevel[];
  facts: InspiredesignMediaFacts;
  designGuidance: InspiredesignMediaDesignGuidance;
  confidence: number;
  limitations: string[];
};

export type InspiredesignMediaAnalysis = {
  version: typeof INSPIREDESIGN_MEDIA_ANALYSIS_VERSION;
  generatedAt: string;
  nonGoals: readonly string[];
  references: InspiredesignMediaAnalysisReference[];
};

export type InspiredesignRgbFrame = {
  width: number;
  height: number;
  data: Uint8Array;
  frameIndex: number;
};

export type InspiredesignMediaAnalysisInput = {
  referenceId: string;
  mediaPath: string;
  filePath: string;
  sourceUrl?: string;
  mediaUrl?: string;
  kind: InspiredesignMediaKind;
  contentType?: string;
  bytes?: number;
  hash?: string;
  width?: number;
  height?: number;
  authority: InspiredesignMediaAuthority;
  scheduledForBundle: boolean;
};

export type InspiredesignMediaAdapterResult<T> = {
  value?: T;
  limitations: string[];
};
