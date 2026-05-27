import type { PinterestSourcePageQuality } from "./pinterest-media-classification";

export type InspiredesignMotionEvidenceStatus = "captured" | "skipped" | "failed";
export type InspiredesignMotionEvidenceKind = "screencast";
export type InspiredesignMotionEvidenceAuthority = "design_evidence" | "diagnostic";

export type InspiredesignMotionEvidenceFileRuntimeMetadata = {
  tempPath?: string;
  path?: string;
  sha256?: string;
  bytes?: number;
};

export type InspiredesignMotionEvidenceFileMetadata = {
  path?: string;
  sha256?: string;
  bytes?: number;
};

export type InspiredesignMotionEvidenceRuntimeMetadata = {
  status: InspiredesignMotionEvidenceStatus;
  kind: InspiredesignMotionEvidenceKind;
  capturedAt: string;
  sourceUrl?: string;
  startedSourceUrl?: string;
  endedSourceUrl?: string;
  pinterestPageQuality?: PinterestSourcePageQuality;
  startedPinterestPageQuality?: PinterestSourcePageQuality;
  endedPinterestPageQuality?: PinterestSourcePageQuality;
  replay?: InspiredesignMotionEvidenceFileRuntimeMetadata;
  replayHtml?: InspiredesignMotionEvidenceFileRuntimeMetadata;
  preview?: InspiredesignMotionEvidenceFileRuntimeMetadata;
  outputDir?: string;
  frameCount: number;
  warnings: string[];
  failure?: string;
  diagnostic: boolean;
  diagnosticReasons: string[];
};

export type InspiredesignPersistedMotionEvidence = {
  status: InspiredesignMotionEvidenceStatus;
  kind: InspiredesignMotionEvidenceKind;
  capturedAt: string;
  sourceUrl?: string;
  startedSourceUrl?: string;
  endedSourceUrl?: string;
  pinterestPageQuality?: PinterestSourcePageQuality;
  startedPinterestPageQuality?: PinterestSourcePageQuality;
  endedPinterestPageQuality?: PinterestSourcePageQuality;
  replay?: InspiredesignMotionEvidenceFileMetadata;
  replayHtml?: InspiredesignMotionEvidenceFileMetadata;
  preview?: InspiredesignMotionEvidenceFileMetadata;
  frameCount: number;
  warnings: string[];
  failure?: string;
  diagnostic: boolean;
  diagnosticReasons: string[];
  authority: InspiredesignMotionEvidenceAuthority;
};

type PersistMotionEvidenceOptions = {
  replayPath?: string;
  replayHtmlPath?: string;
  previewPath?: string;
  replaySha256?: string;
  replayBytes?: number;
  previewSha256?: string;
  previewBytes?: number;
};

const SAFE_REFERENCE_ID_PATTERN = /[^a-z0-9._-]+/gi;
const MAX_REFERENCE_ID_LENGTH = 96;
const MAX_TEXT_LENGTH = 240;
const DOT_ONLY_PATH_SEGMENT_PATTERN = /^\.+$/;
const MOTION_ARTIFACT_RELATIVE_PATH_PATTERN = /^(?:replay\.json|replay\.html|preview\.png|frames\/[A-Za-z0-9._-]+\.png)$/;
const MOTION_ARTIFACT_PATH_PATTERN = /^motion-evidence\/([A-Za-z0-9._-]+)\/(?:replay\.json|replay\.html|preview\.png|frames\/[A-Za-z0-9._-]+\.png)$/;
const UNSAFE_MOTION_TEXT_PATTERN =
  /(?:\/(?:Users|private|tmp|var|Volumes)\/|[A-Za-z]:\\|\\|data:image|;base64|base64,|[A-Za-z0-9+/]{80,}={0,2})/i;
const FALLBACK_CAPTURED_AT = "1970-01-01T00:00:00.000Z";
export const MOTION_EVIDENCE_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
export const MIN_MOTION_REPLAY_BYTES = 16;
export const MIN_MOTION_PREVIEW_BYTES = 1024;
const PINTEREST_PAGE_QUALITIES = new Set<PinterestSourcePageQuality>([
  "pin_media",
  "pin_grid_media",
  "search_shell",
  "chrome_only",
  "login_challenge",
  "unknown",
  "invalid"
]);

export const sanitizeInspiredesignMotionReferenceId = (referenceId: string): string => {
  const sanitized = referenceId.trim().replace(SAFE_REFERENCE_ID_PATTERN, "-").replace(/^[.-]+|[.-]+$/g, "");
  if (!sanitized || DOT_ONLY_PATH_SEGMENT_PATTERN.test(sanitized)) return "reference";
  const truncated = sanitized.slice(0, MAX_REFERENCE_ID_LENGTH);
  return DOT_ONLY_PATH_SEGMENT_PATTERN.test(truncated) ? "reference" : truncated;
};

export const buildMotionEvidenceArtifactRoot = (referenceId: string): string => (
  `motion-evidence/${sanitizeInspiredesignMotionReferenceId(referenceId)}`
);

export const buildMotionEvidenceArtifactPath = (referenceId: string, relativePath: string): string => {
  const safeRoot = buildMotionEvidenceArtifactRoot(referenceId);
  const normalized = relativePath.replaceAll("\\", "/").trim();
  if (!MOTION_ARTIFACT_RELATIVE_PATH_PATTERN.test(normalized)) return `${safeRoot}/replay.json`;
  return normalized ? `${safeRoot}/${normalized}` : `${safeRoot}/replay.json`;
};

const sanitizeText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_MOTION_TEXT_PATTERN.test(trimmed)) return undefined;
  return trimmed.slice(0, MAX_TEXT_LENGTH);
};

const sanitizeCapturedAt = (value: unknown): string => {
  const text = sanitizeText(value);
  if (!text) return FALLBACK_CAPTURED_AT;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : FALLBACK_CAPTURED_AT;
};

const sanitizeMotionPath = (value: unknown): string | undefined => {
  const text = sanitizeText(value);
  if (!text) return undefined;
  const match = MOTION_ARTIFACT_PATH_PATTERN.exec(text);
  const referenceSegment = match?.[1];
  if (!referenceSegment || DOT_ONLY_PATH_SEGMENT_PATTERN.test(referenceSegment)) return undefined;
  return text;
};

const sanitizeSha256 = (value: unknown): string | undefined => (
  typeof value === "string" && MOTION_EVIDENCE_SHA256_HEX_PATTERN.test(value) ? value : undefined
);

const sanitizePositiveBytes = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
);

const sanitizePinterestPageQuality = (value: unknown): PinterestSourcePageQuality | undefined => (
  typeof value === "string" && PINTEREST_PAGE_QUALITIES.has(value as PinterestSourcePageQuality)
    ? value as PinterestSourcePageQuality
    : undefined
);

const buildMotionFileMetadata = (
  path: string | undefined,
  sha256: unknown,
  bytes: unknown
): InspiredesignMotionEvidenceFileMetadata | undefined => {
  if (!path) return undefined;
  const sanitizedSha256 = sanitizeSha256(sha256);
  const sanitizedBytes = sanitizePositiveBytes(bytes);
  return {
    path,
    ...(sanitizedSha256 ? { sha256: sanitizedSha256 } : {}),
    ...(sanitizedBytes ? { bytes: sanitizedBytes } : {})
  };
};

const sanitizeWarnings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeText).filter((warning): warning is string => Boolean(warning));
};

const normalizeMotionWarningMarker = (value: string): string => value.toLowerCase().replace(/[\s-]+/g, "_");

const normalizeFrameCount = (value: unknown): number => (
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : 0
);

const normalizeDiagnosticReasons = (
  metadata: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence
): string[] => {
  const baseReasons = sanitizeWarnings(metadata.diagnosticReasons);
  const warnings = sanitizeWarnings(metadata.warnings);
  const reasons = new Set(baseReasons);
  if (metadata.frameCount === 0) reasons.add("zero_frame_capture");
  if (warnings.some((warning) => normalizeMotionWarningMarker(warning).includes("controls_only"))) {
    reasons.add("controls_only_capture");
  }
  return Array.from(reasons);
};

export const persistInspiredesignMotionEvidence = (
  metadata: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence,
  options: PersistMotionEvidenceOptions = {}
): InspiredesignPersistedMotionEvidence => {
  const frameCount = normalizeFrameCount(metadata.frameCount);
  const diagnosticReasons = normalizeDiagnosticReasons({ ...metadata, frameCount });
  const diagnostic = metadata.diagnostic === true || frameCount === 0 || diagnosticReasons.length > 0;
  const status = metadata.status === "failed" || metadata.status === "skipped" ? metadata.status : "captured";
  const replayPath = sanitizeMotionPath(options.replayPath) ?? sanitizeMotionPath(metadata.replay?.path);
  const replayHtmlPath = sanitizeMotionPath(options.replayHtmlPath) ?? sanitizeMotionPath(metadata.replayHtml?.path);
  const previewPath = sanitizeMotionPath(options.previewPath) ?? sanitizeMotionPath(metadata.preview?.path);
  const replay = buildMotionFileMetadata(
    replayPath,
    options.replaySha256 ?? metadata.replay?.sha256,
    options.replayBytes ?? metadata.replay?.bytes
  );
  const replayHtml = buildMotionFileMetadata(replayHtmlPath, metadata.replayHtml?.sha256, metadata.replayHtml?.bytes);
  const preview = buildMotionFileMetadata(
    previewPath,
    options.previewSha256 ?? metadata.preview?.sha256,
    options.previewBytes ?? metadata.preview?.bytes
  );
  return {
    status,
    kind: "screencast",
    capturedAt: sanitizeCapturedAt(metadata.capturedAt),
    ...(sanitizeText(metadata.sourceUrl) ? { sourceUrl: sanitizeText(metadata.sourceUrl) } : {}),
    ...(sanitizeText(metadata.startedSourceUrl) ? { startedSourceUrl: sanitizeText(metadata.startedSourceUrl) } : {}),
    ...(sanitizeText(metadata.endedSourceUrl) ? { endedSourceUrl: sanitizeText(metadata.endedSourceUrl) } : {}),
    ...(sanitizePinterestPageQuality(metadata.pinterestPageQuality)
      ? { pinterestPageQuality: sanitizePinterestPageQuality(metadata.pinterestPageQuality) }
      : {}),
    ...(sanitizePinterestPageQuality(metadata.startedPinterestPageQuality)
      ? { startedPinterestPageQuality: sanitizePinterestPageQuality(metadata.startedPinterestPageQuality) }
      : {}),
    ...(sanitizePinterestPageQuality(metadata.endedPinterestPageQuality)
      ? { endedPinterestPageQuality: sanitizePinterestPageQuality(metadata.endedPinterestPageQuality) }
      : {}),
    ...(replay ? { replay } : {}),
    ...(replayHtml ? { replayHtml } : {}),
    ...(preview ? { preview } : {}),
    frameCount,
    warnings: sanitizeWarnings(metadata.warnings),
    ...(sanitizeText(metadata.failure) ? { failure: sanitizeText(metadata.failure) } : {}),
    diagnostic,
    diagnosticReasons,
    authority: status === "captured" && !diagnostic ? "design_evidence" : "diagnostic"
  };
};
