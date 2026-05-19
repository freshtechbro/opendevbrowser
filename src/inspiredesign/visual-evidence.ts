import { createHash } from "crypto";

export const INSPIREDESIGN_VISUAL_EVIDENCE_MODES = ["off", "auto", "required"] as const;
export const INSPIREDESIGN_VISUAL_EVIDENCE_KINDS = ["viewport", "full_page"] as const;

export type InspiredesignVisualEvidenceMode = typeof INSPIREDESIGN_VISUAL_EVIDENCE_MODES[number];
export type InspiredesignVisualEvidenceKind = typeof INSPIREDESIGN_VISUAL_EVIDENCE_KINDS[number];
export type InspiredesignVisualEvidenceStatus = "captured" | "skipped" | "failed";

export type InspiredesignVisualEvidenceViewport = {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
};

export type InspiredesignVisualEvidenceRuntimeMetadata = {
  status: InspiredesignVisualEvidenceStatus;
  kind: InspiredesignVisualEvidenceKind;
  fullPage: boolean;
  capturedAt: string;
  artifactPath?: string;
  tempPath?: string;
  viewport?: InspiredesignVisualEvidenceViewport;
  warnings: string[];
  failure?: string;
};

export type InspiredesignPersistedVisualEvidence = {
  status: InspiredesignVisualEvidenceStatus;
  kind: InspiredesignVisualEvidenceKind;
  fullPage: boolean;
  capturedAt: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  viewport?: InspiredesignVisualEvidenceViewport;
  warnings: string[];
  failure?: string;
};

type PersistVisualEvidenceOptions = {
  artifactPath?: string;
  sha256?: string;
  bytes?: number;
};

const SAFE_REFERENCE_ID_PATTERN = /[^a-z0-9._-]+/gi;
const MAX_VISUAL_REFERENCE_ID_LENGTH = 96;
const MAX_VISUAL_WARNING_LENGTH = 160;
const MAX_VISUAL_FAILURE_LENGTH = 240;
const UNSAFE_VISUAL_TEXT_PATTERN =
  /(?:\/(?:Users|private|tmp|var|Volumes)\/|[A-Za-z]:\\|\\|data:image|;base64|base64,|[A-Za-z0-9+/]{80,}={0,2})/i;
const DOT_ONLY_PATH_SEGMENT_PATTERN = /^\.+$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const VISUAL_ARTIFACT_PATH_PATTERN =
  /^visual-evidence\/([A-Za-z0-9._-]+)\/(?:viewport|full_page)\.png$/;
const FALLBACK_VISUAL_CAPTURED_AT = "1970-01-01T00:00:00.000Z";

export const isInspiredesignVisualEvidenceMode = (
  value: unknown
): value is InspiredesignVisualEvidenceMode => (
  typeof value === "string"
  && (INSPIREDESIGN_VISUAL_EVIDENCE_MODES as readonly string[]).includes(value)
);

export const isInspiredesignVisualEvidenceKind = (
  value: unknown
): value is InspiredesignVisualEvidenceKind => (
  typeof value === "string"
  && (INSPIREDESIGN_VISUAL_EVIDENCE_KINDS as readonly string[]).includes(value)
);

export const sanitizeInspiredesignVisualReferenceId = (referenceId: string): string => {
  const sanitized = referenceId.trim().replace(SAFE_REFERENCE_ID_PATTERN, "-").replace(/^-+|-+$/g, "");
  if (!sanitized || DOT_ONLY_PATH_SEGMENT_PATTERN.test(sanitized)) return "reference";
  const truncated = sanitized.slice(0, MAX_VISUAL_REFERENCE_ID_LENGTH);
  return DOT_ONLY_PATH_SEGMENT_PATTERN.test(truncated) ? "reference" : truncated;
};

export const buildVisualEvidenceArtifactPath = (
  referenceId: string,
  kind: InspiredesignVisualEvidenceKind
): string => `visual-evidence/${sanitizeInspiredesignVisualReferenceId(referenceId)}/${kind}.png`;

export const hashVisualEvidenceBuffer = (buffer: Buffer): string => (
  createHash("sha256").update(buffer).digest("hex")
);

const sanitizeVisualEvidenceText = (
  value: unknown,
  maxLength: number
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_VISUAL_TEXT_PATTERN.test(trimmed)) return undefined;
  return trimmed.slice(0, maxLength);
};

const sanitizeVisualEvidencePath = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = VISUAL_ARTIFACT_PATH_PATTERN.exec(trimmed);
  const referenceSegment = match?.[1];
  if (!referenceSegment || DOT_ONLY_PATH_SEGMENT_PATTERN.test(referenceSegment)) return undefined;
  return trimmed;
};

const sanitizeVisualEvidenceSha256 = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return SHA256_HEX_PATTERN.test(trimmed) ? trimmed.toLowerCase() : undefined;
};

const sanitizeVisualEvidenceBytes = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : undefined
);

const sanitizeVisualEvidenceCapturedAt = (value: unknown): string => {
  if (typeof value !== "string") return FALLBACK_VISUAL_CAPTURED_AT;
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_VISUAL_TEXT_PATTERN.test(trimmed)) return FALLBACK_VISUAL_CAPTURED_AT;
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return FALLBACK_VISUAL_CAPTURED_AT;
  return new Date(timestamp).toISOString();
};

const normalizeVisualEvidenceViewport = (
  value: unknown
): InspiredesignVisualEvidenceViewport | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const viewport: InspiredesignVisualEvidenceViewport = {};
  if (typeof record.width === "number" && Number.isFinite(record.width)) {
    viewport.width = record.width;
  }
  if (typeof record.height === "number" && Number.isFinite(record.height)) {
    viewport.height = record.height;
  }
  if (typeof record.deviceScaleFactor === "number" && Number.isFinite(record.deviceScaleFactor)) {
    viewport.deviceScaleFactor = record.deviceScaleFactor;
  }
  return Object.keys(viewport).length > 0 ? viewport : undefined;
};

const normalizeVisualEvidenceWarnings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((warning) => sanitizeVisualEvidenceText(warning, MAX_VISUAL_WARNING_LENGTH))
    .filter((warning): warning is string => Boolean(warning));
};

export const persistInspiredesignVisualEvidence = (
  metadata: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence,
  options: PersistVisualEvidenceOptions = {}
): InspiredesignPersistedVisualEvidence => {
  const runtimeMetadata = metadata as InspiredesignVisualEvidenceRuntimeMetadata;
  const persistedMetadata = metadata as InspiredesignPersistedVisualEvidence;
  const path = metadata.status === "captured"
    ? sanitizeVisualEvidencePath(options.artifactPath)
      ?? sanitizeVisualEvidencePath(persistedMetadata.path)
      ?? sanitizeVisualEvidencePath(runtimeMetadata.artifactPath)
    : undefined;
  const sha256 = sanitizeVisualEvidenceSha256(options.sha256) ?? sanitizeVisualEvidenceSha256(persistedMetadata.sha256);
  const bytes = sanitizeVisualEvidenceBytes(options.bytes) ?? sanitizeVisualEvidenceBytes(persistedMetadata.bytes);
  const capturedAt = sanitizeVisualEvidenceCapturedAt(metadata.capturedAt);
  const viewport = normalizeVisualEvidenceViewport(metadata.viewport);
  const failure = sanitizeVisualEvidenceText(metadata.failure, MAX_VISUAL_FAILURE_LENGTH);
  return {
    status: metadata.status,
    kind: isInspiredesignVisualEvidenceKind(metadata.kind) ? metadata.kind : "viewport",
    fullPage: metadata.fullPage === true,
    capturedAt,
    ...(path ? { path } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(viewport ? { viewport } : {}),
    warnings: normalizeVisualEvidenceWarnings(metadata.warnings),
    ...(failure ? { failure } : {})
  };
};
