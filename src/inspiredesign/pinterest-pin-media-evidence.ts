import { createHash } from "crypto";
import { normalizePinterestReferenceUrl } from "../guidance/recipes/pinterest";
import {
  isCanonicalPinterestPinUrl,
  type PinterestSourcePageQuality
} from "./pinterest-media-classification";

export const INSPIREDESIGN_PIN_MEDIA_EVIDENCE_KINDS = ["image", "video", "video_poster"] as const;
export const INSPIREDESIGN_PIN_MEDIA_EVIDENCE_EXTENSIONS = ["avif", "gif", "jpg", "jpeg", "mp4", "png", "webp"] as const;
export const INSPIREDESIGN_PIN_MEDIA_EVIDENCE_CONTENT_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4"
] as const;

export type InspiredesignPinterestPinMediaEvidenceKind = typeof INSPIREDESIGN_PIN_MEDIA_EVIDENCE_KINDS[number];
export type InspiredesignPinterestPinMediaExtension = typeof INSPIREDESIGN_PIN_MEDIA_EVIDENCE_EXTENSIONS[number];
export type InspiredesignPinterestPinMediaContentType = typeof INSPIREDESIGN_PIN_MEDIA_EVIDENCE_CONTENT_TYPES[number];
export type InspiredesignPinterestPinMediaEvidenceStatus = "captured" | "skipped" | "failed";
export type InspiredesignPinterestPinMediaEvidenceAuthority = "design_evidence" | "diagnostic";

export type InspiredesignPinterestPinMediaFirstPartyProvenance = {
  canonicalReferenceUrl?: string;
  canonicalSourceUrl?: string;
  referenceUrlCanonical: boolean;
  sourceUrlMatchesReference: boolean;
  mediaUrlFirstParty: boolean;
};

export type InspiredesignPinterestPinMediaDimensions = {
  width: number;
  height: number;
};

export type InspiredesignPinterestPinMediaRuntimeMetadata = {
  status: InspiredesignPinterestPinMediaEvidenceStatus;
  kind: InspiredesignPinterestPinMediaEvidenceKind;
  capturedAt: string;
  referenceId: string;
  url: string;
  sourceUrl?: string;
  startedSourceUrl?: string;
  endedSourceUrl?: string;
  pinterestPageQuality?: PinterestSourcePageQuality;
  mediaUrl?: string;
  candidateSelector?: string;
  candidateRole?: string;
  candidateAlt?: string;
  width?: number;
  height?: number;
  contentType?: string;
  tempPath?: string;
  warnings: string[];
  failure?: string;
  rejectionReasons: string[];
  firstPartyProvenance?: InspiredesignPinterestPinMediaFirstPartyProvenance;
};

export type InspiredesignPersistedPinterestPinMediaEvidence = {
  status: InspiredesignPinterestPinMediaEvidenceStatus;
  kind: InspiredesignPinterestPinMediaEvidenceKind;
  authority: InspiredesignPinterestPinMediaEvidenceAuthority;
  capturedAt: string;
  referenceId: string;
  url: string;
  sourceUrl?: string;
  startedSourceUrl?: string;
  endedSourceUrl?: string;
  pinterestPageQuality?: PinterestSourcePageQuality;
  mediaUrl?: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  width?: number;
  height?: number;
  contentType?: InspiredesignPinterestPinMediaContentType;
  candidateSelector?: string;
  candidateRole?: string;
  candidateAlt?: string;
  warnings: string[];
  failure?: string;
  rejectionReasons: string[];
  firstPartyProvenance: InspiredesignPinterestPinMediaFirstPartyProvenance;
};

export type InspiredesignPinterestPinMediaIndexEntry = {
  referenceId: string;
  url: string;
  sourceUrl: string;
  mediaUrl: string;
  pinterestPageQuality: PinterestSourcePageQuality;
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  contentType: InspiredesignPinterestPinMediaContentType;
  kind: InspiredesignPinterestPinMediaEvidenceKind;
  authority: "design_evidence";
  capturedAt: string;
  candidateSelector?: string;
  candidateRole?: string;
  candidateAlt?: string;
  warnings: string[];
  firstPartyProvenance: InspiredesignPinterestPinMediaFirstPartyProvenance;
};

export type PinterestPinMediaPersistOptions = {
  artifactPath?: string;
  sha256?: string;
  bytes?: number;
  buffer?: Buffer;
};

const TRUSTED_PIN_MEDIA_ROUND_TRIP_SIGNATURE: unique symbol = Symbol("trusted_pin_media_round_trip_signature");

type TrustedPinterestPinMediaRoundTripEvidence = Partial<InspiredesignPersistedPinterestPinMediaEvidence> & {
  [TRUSTED_PIN_MEDIA_ROUND_TRIP_SIGNATURE]?: string;
};

export type PinterestPinMediaByteVerification = {
  ok: boolean;
  sha256?: string;
  bytes?: number;
  reasons: string[];
};

export type PinterestPinMediaByteInspection = {
  contentType?: InspiredesignPinterestPinMediaContentType;
  extension?: InspiredesignPinterestPinMediaExtension;
  width?: number;
  height?: number;
  reasons: string[];
};

const SAFE_REFERENCE_ID_PATTERN = /[^a-z0-9._-]+/gi;
const DOT_ONLY_PATH_SEGMENT_PATTERN = /^\.+$/;
const MAX_REFERENCE_ID_LENGTH = 96;
const MAX_TEXT_LENGTH = 240;
const MAX_ALT_TEXT_LENGTH = 360;
const FALLBACK_CAPTURED_AT = "1970-01-01T00:00:00.000Z";
const PINTEREST_PIN_MEDIA_HOSTS = new Set(["i.pinimg.com", "v.pinimg.com"]);
const PINTEREST_PIN_VIDEO_EDGE_MEDIA_HOST_PATTERN = /^v\d+(?:-[a-z]+)?\.pinimg\.com$/i;
const PINTEREST_AUTHORITY_HOST = "www.pinterest.com";
const PIN_MEDIA_PAGE_QUALITY: PinterestSourcePageQuality = "pin_media";
const PIN_MEDIA_ARTIFACT_ROOT = "pin-media-evidence";
const PIN_MEDIA_MAIN_BASENAME = "main";
const PIN_MEDIA_POSTER_BASENAME = "poster";
const PIN_MEDIA_VIDEO_BASENAME = "video";
export const MIN_PIN_MEDIA_EVIDENCE_BYTES = 1024;
export const MIN_PIN_MEDIA_EVIDENCE_WIDTH = 320;
export const MIN_PIN_MEDIA_EVIDENCE_HEIGHT = 320;
export const PINTEREST_PIN_MEDIA_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

const PIN_MEDIA_ARTIFACT_PATH_PATTERN =
  /^pin-media-evidence\/([A-Za-z0-9._-]+)\/(main|poster|video)\.(avif|gif|jpe?g|mp4|png|webp)$/i;
const UNSAFE_TEXT_PATTERN =
  /(?:\/(?:Users|private|tmp|var|Volumes)\/|[A-Za-z]:\\|\\|data:image|;base64|base64,|[A-Za-z0-9+/]{80,}={0,2})/i;
const BLOCKING_WARNING_MARKERS = [
  "blank",
  "empty",
  "tiny",
  "small_media",
  "login",
  "challenge",
  "captcha",
  "search_shell",
  "interface_chrome",
  "chrome_only",
  "controls_only",
  "blocked",
  "promoted",
  "ad"
] as const;
const NON_BLOCKING_PIN_MEDIA_WARNING_MARKERS = new Set([
  "login_or_challenge_state"
]);
const PINTEREST_PAGE_QUALITIES = new Set<PinterestSourcePageQuality>([
  "pin_media",
  "pin_grid_media",
  "search_shell",
  "chrome_only",
  "login_challenge",
  "unknown",
  "invalid"
]);
const CONTENT_TYPE_TO_EXTENSION: Record<InspiredesignPinterestPinMediaContentType, InspiredesignPinterestPinMediaExtension> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4"
};

const JPEG_START_OF_FRAME_MARKERS = new Set<number>([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF_SIGNATURE = "RIFF";
const WEBP_SIGNATURE = "WEBP";
const GIF_87A_SIGNATURE = "GIF87a";
const GIF_89A_SIGNATURE = "GIF89a";
const AVIF_BRANDS = new Set(["avif", "avis"]);
const MP4_BRANDS = new Set(["avc1", "dash", "isom", "iso2", "mp41", "mp42", "M4V "]);
const MP4_BOX_SIZE_BYTES = 4;
const MP4_BOX_TYPE_BYTES = 4;
const MP4_BOX_HEADER_BYTES = MP4_BOX_SIZE_BYTES + MP4_BOX_TYPE_BYTES;
const MP4_EXTENDED_SIZE_MARKER = 1;
const MP4_TKHD_BOX_TYPE = "tkhd";
const MP4_MOOV_BOX_TYPE = "moov";
const MP4_TRAK_BOX_TYPE = "trak";
const MP4_TKHD_VERSION_0_DIMENSIONS_OFFSET = 76;
const MP4_TKHD_VERSION_1_DIMENSIONS_OFFSET = 88;
const MP4_FIXED_POINT_SCALE = 65_536;

type Mp4Box = {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
};

const readUInt24LE = (buffer: Buffer, offset: number): number => {
  return buffer.readUIntLE(offset, 3);
};

const inspectPngDimensions = (buffer: Buffer): PinterestPinMediaByteInspection | undefined => {
  if (buffer.length < 24 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return undefined;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    return { contentType: "image/png", extension: "png", reasons: ["missing_dimensions"] };
  }
  return {
    contentType: "image/png",
    extension: "png",
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    reasons: []
  };
};

const inspectGifDimensions = (buffer: Buffer): PinterestPinMediaByteInspection | undefined => {
  if (buffer.length < 10) return undefined;
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature !== GIF_87A_SIGNATURE && signature !== GIF_89A_SIGNATURE) return undefined;
  return {
    contentType: "image/gif",
    extension: "gif",
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
    reasons: []
  };
};

const inspectJpegDimensions = (buffer: Buffer): PinterestPinMediaByteInspection | undefined => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1] as number;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && length >= 7) {
      return {
        contentType: "image/jpeg",
        extension: "jpg",
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        reasons: []
      };
    }
    offset += 2 + length;
  }
  return { contentType: "image/jpeg", extension: "jpg", reasons: ["missing_dimensions"] };
};

const inspectWebpDimensions = (buffer: Buffer): PinterestPinMediaByteInspection | undefined => {
  if (buffer.length < 16 || buffer.subarray(0, 4).toString("ascii") !== RIFF_SIGNATURE) return undefined;
  if (buffer.subarray(8, 12).toString("ascii") !== WEBP_SIGNATURE) return undefined;
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType === "VP8X" && buffer.length >= 30) {
    const width = readUInt24LE(buffer, 24);
    const height = readUInt24LE(buffer, 27);
    return {
      contentType: "image/webp",
      extension: "webp",
      width: width + 1,
      height: height + 1,
      reasons: []
    };
  }
  if (chunkType === "VP8 " && buffer.length >= 30) {
    return {
      contentType: "image/webp",
      extension: "webp",
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      reasons: []
    };
  }
  if (chunkType === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      contentType: "image/webp",
      extension: "webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      reasons: []
    };
  }
  return { contentType: "image/webp", extension: "webp", reasons: ["missing_dimensions"] };
};

const hasAvifBrand = (buffer: Buffer): boolean => {
  if (buffer.length < 16 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  for (let offset = 8; offset + 3 < Math.min(buffer.length, 40); offset += 4) {
    if (AVIF_BRANDS.has(buffer.subarray(offset, offset + 4).toString("ascii"))) return true;
  }
  return false;
};

const inspectAvifDimensions = (buffer: Buffer): PinterestPinMediaByteInspection | undefined => {
  if (!hasAvifBrand(buffer)) return undefined;
  const ispeType = Buffer.from("ispe", "ascii");
  const typeOffset = buffer.indexOf(ispeType);
  if (typeOffset < 4 || typeOffset + 16 > buffer.length) {
    return { contentType: "image/avif", extension: "avif", reasons: ["missing_dimensions"] };
  }
  return {
    contentType: "image/avif",
    extension: "avif",
    width: buffer.readUInt32BE(typeOffset + 8),
    height: buffer.readUInt32BE(typeOffset + 12),
    reasons: []
  };
};

const readMp4FixedPointDimension = (buffer: Buffer, offset: number): number | undefined => {
  const value = buffer.readUInt32BE(offset) / MP4_FIXED_POINT_SCALE;
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
};

const mp4TkhdDimensionsOffsetForVersion = (version: number | undefined): number | undefined => {
  if (version === 0) return MP4_TKHD_VERSION_0_DIMENSIONS_OFFSET;
  if (version === 1) return MP4_TKHD_VERSION_1_DIMENSIONS_OFFSET;
  return undefined;
};

const readMp4Box = (buffer: Buffer, offset: number, limit: number): Mp4Box | undefined => {
  if (offset + MP4_BOX_HEADER_BYTES > limit) return undefined;
  const boxSize = buffer.readUInt32BE(offset);
  if (boxSize === MP4_EXTENDED_SIZE_MARKER || boxSize < MP4_BOX_HEADER_BYTES) return undefined;
  const end = offset + boxSize;
  if (end > limit || end > buffer.length) return undefined;
  return {
    type: buffer.subarray(offset + MP4_BOX_SIZE_BYTES, offset + MP4_BOX_HEADER_BYTES).toString("ascii"),
    start: offset,
    payloadStart: offset + MP4_BOX_HEADER_BYTES,
    end
  };
};

const findMp4Boxes = (buffer: Buffer, start: number, end: number, type: string): Mp4Box[] => {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + MP4_BOX_HEADER_BYTES <= end) {
    const box = readMp4Box(buffer, offset, end);
    if (!box) break;
    if (box.type === type) boxes.push(box);
    offset = box.end;
  }
  return boxes;
};

const readMp4TkhdDimensionsAt = (buffer: Buffer, box: Mp4Box): InspiredesignPinterestPinMediaDimensions | undefined => {
  const versionOffset = box.payloadStart;
  const version = buffer[versionOffset];
  const dimensionsOffset = mp4TkhdDimensionsOffsetForVersion(version);
  if (!dimensionsOffset) return undefined;
  const widthOffset = versionOffset + dimensionsOffset;
  const heightOffset = widthOffset + MP4_BOX_SIZE_BYTES;
  if (heightOffset + MP4_BOX_SIZE_BYTES > buffer.length || heightOffset + MP4_BOX_SIZE_BYTES > box.end) return undefined;
  const width = readMp4FixedPointDimension(buffer, widthOffset);
  const height = readMp4FixedPointDimension(buffer, heightOffset);
  return width && height ? { width, height } : undefined;
};

const readMp4TkhdDimensions = (buffer: Buffer): InspiredesignPinterestPinMediaDimensions | undefined => {
  for (const moov of findMp4Boxes(buffer, 0, buffer.length, MP4_MOOV_BOX_TYPE)) {
    for (const trak of findMp4Boxes(buffer, moov.payloadStart, moov.end, MP4_TRAK_BOX_TYPE)) {
      for (const tkhd of findMp4Boxes(buffer, trak.payloadStart, trak.end, MP4_TKHD_BOX_TYPE)) {
        const dimensions = readMp4TkhdDimensionsAt(buffer, tkhd);
        if (dimensions) return dimensions;
      }
    }
  }
  return undefined;
};

const inspectMp4Bytes = (buffer: Buffer): PinterestPinMediaByteInspection | undefined => {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return undefined;
  for (let offset = 8; offset + 3 < Math.min(buffer.length, 64); offset += 4) {
    if (MP4_BRANDS.has(buffer.subarray(offset, offset + 4).toString("ascii"))) {
      const dimensions = readMp4TkhdDimensions(buffer);
      return {
        contentType: "video/mp4",
        extension: "mp4",
        ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
        reasons: dimensions ? [] : ["missing_dimensions"]
      };
    }
  }
  return undefined;
};

const normalizedInspection = (inspection: PinterestPinMediaByteInspection): PinterestPinMediaByteInspection => {
  const reasons = new Set(inspection.reasons);
  const requiresByteDimensions = !inspection.contentType || inspection.contentType.startsWith("image/");
  if (requiresByteDimensions && (!inspection.width || !inspection.height)) reasons.add("missing_dimensions");
  if (inspection.width !== undefined && inspection.width < MIN_PIN_MEDIA_EVIDENCE_WIDTH) reasons.add("dimensions_below_minimum");
  if (inspection.height !== undefined && inspection.height < MIN_PIN_MEDIA_EVIDENCE_HEIGHT) reasons.add("dimensions_below_minimum");
  return { ...inspection, reasons: Array.from(reasons) };
};

export const inspectPinterestPinMediaBuffer = (buffer: Buffer | undefined): PinterestPinMediaByteInspection => {
  if (!buffer || buffer.length === 0) return { reasons: ["missing_bytes"] };
  const inspection = inspectPngDimensions(buffer)
    ?? inspectGifDimensions(buffer)
    ?? inspectJpegDimensions(buffer)
    ?? inspectWebpDimensions(buffer)
    ?? inspectAvifDimensions(buffer)
    ?? inspectMp4Bytes(buffer);
  return normalizedInspection(inspection ?? { reasons: ["unsupported_byte_signature"] });
};

const artifactExtension = (path: string | undefined): InspiredesignPinterestPinMediaExtension | undefined => {
  const extension = path?.split(".").pop()?.toLowerCase();
  if (!extension) return undefined;
  return extension as InspiredesignPinterestPinMediaExtension;
};

const artifactExtensionMatchesContentType = (
  extension: InspiredesignPinterestPinMediaExtension | undefined,
  contentType: InspiredesignPinterestPinMediaContentType | undefined
): boolean => {
  if (!extension || !contentType) return false;
  if (contentType === "image/jpeg") return extension === "jpg" || extension === "jpeg";
  return extension === extensionForPinterestPinMediaContentType(contentType);
};

export const isInspiredesignPinterestPinMediaEvidenceKind = (
  value: string
): value is InspiredesignPinterestPinMediaEvidenceKind => (
  (INSPIREDESIGN_PIN_MEDIA_EVIDENCE_KINDS as readonly string[]).includes(value)
);

export const isPinterestPinMediaEvidenceContentType = (
  value: string
): value is InspiredesignPinterestPinMediaContentType => (
  (INSPIREDESIGN_PIN_MEDIA_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(value)
);

export const extensionForPinterestPinMediaContentType = (
  contentType: InspiredesignPinterestPinMediaContentType
): InspiredesignPinterestPinMediaExtension => CONTENT_TYPE_TO_EXTENSION[contentType];

export const sanitizeInspiredesignPinterestPinMediaReferenceId = (referenceId: string): string => {
  const sanitized = referenceId.trim().replace(SAFE_REFERENCE_ID_PATTERN, "-").replace(/^[.-]+|[.-]+$/g, "");
  if (!sanitized || DOT_ONLY_PATH_SEGMENT_PATTERN.test(sanitized)) return "reference";
  return sanitized.slice(0, MAX_REFERENCE_ID_LENGTH);
};

export const buildPinterestPinMediaEvidenceArtifactRoot = (referenceId: string): string => (
  `${PIN_MEDIA_ARTIFACT_ROOT}/${sanitizeInspiredesignPinterestPinMediaReferenceId(referenceId)}`
);

const basenameForPinMediaKind = (kind: InspiredesignPinterestPinMediaEvidenceKind): string => {
  if (kind === "video") return PIN_MEDIA_VIDEO_BASENAME;
  if (kind === "video_poster") return PIN_MEDIA_POSTER_BASENAME;
  return PIN_MEDIA_MAIN_BASENAME;
};

export const buildPinterestPinMediaEvidenceArtifactPath = (
  referenceId: string,
  kind: InspiredesignPinterestPinMediaEvidenceKind,
  extension: InspiredesignPinterestPinMediaExtension
): string => {
  const basename = basenameForPinMediaKind(kind);
  return `${buildPinterestPinMediaEvidenceArtifactRoot(referenceId)}/${basename}.${extension}`;
};

export const hashPinterestPinMediaEvidenceBuffer = (buffer: Buffer): string => (
  createHash("sha256").update(buffer).digest("hex")
);

export const isFirstPartyPinterestPinMediaUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isPinnedMediaHost = PINTEREST_PIN_MEDIA_HOSTS.has(hostname)
      || PINTEREST_PIN_VIDEO_EDGE_MEDIA_HOST_PATTERN.test(hostname);
    return url.protocol === "https:" && isPinnedMediaHost && url.pathname !== "/";
  } catch {
    return false;
  }
};

const sanitizeText = (value: string | undefined, maxLength = MAX_TEXT_LENGTH): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_TEXT_PATTERN.test(trimmed)) return undefined;
  return trimmed.slice(0, maxLength);
};

const sanitizeUrl = (value: string | undefined): string | undefined => {
  const text = sanitizeText(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

const sanitizeFirstPartyMediaUrl = (value: string | undefined): string | undefined => {
  const text = sanitizeText(value);
  if (!text || !isFirstPartyPinterestPinMediaUrl(text)) return undefined;
  return new URL(text).href;
};

const sanitizeCapturedAt = (value: string): string => {
  const text = sanitizeText(value);
  if (!text) return FALLBACK_CAPTURED_AT;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : FALLBACK_CAPTURED_AT;
};

const sanitizePinterestPageQuality = (value: PinterestSourcePageQuality | undefined): PinterestSourcePageQuality | undefined => (
  value && PINTEREST_PAGE_QUALITIES.has(value) ? value : undefined
);

const sanitizeSha256 = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return PINTEREST_PIN_MEDIA_SHA256_HEX_PATTERN.test(trimmed) ? trimmed.toLowerCase() : undefined;
};

const sanitizePositiveInteger = (value: number | undefined): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
};

const sanitizeContentType = (value: string | undefined): InspiredesignPinterestPinMediaContentType | undefined => {
  const contentType = sanitizeText(value)?.split(";")[0]?.trim().toLowerCase();
  if (!contentType) return undefined;
  return isPinterestPinMediaEvidenceContentType(contentType) ? contentType : undefined;
};

const sanitizeWarnings = (value: readonly string[] | undefined): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((warning) => sanitizeText(warning)).filter((warning): warning is string => Boolean(warning));
};

const sanitizeRejectionReasons = (value: readonly string[] | undefined): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((reason) => sanitizeText(reason)).filter((reason): reason is string => Boolean(reason));
};

const readPinMediaArtifactPathParts = (value: string | undefined): {
  basename: string;
  extension: string;
  referenceSegment: string;
} | undefined => {
  const text = sanitizeText(value);
  const match = text ? PIN_MEDIA_ARTIFACT_PATH_PATTERN.exec(text) : undefined;
  const referenceSegment = match?.[1];
  const basename = match?.[2];
  const extension = match?.[3]?.toLowerCase();
  if (!referenceSegment || !basename || !extension) return undefined;
  if (DOT_ONLY_PATH_SEGMENT_PATTERN.test(referenceSegment)) return undefined;
  return { basename, extension, referenceSegment };
};

const pinMediaArtifactPathMatchesReferenceId = (path: string | undefined, referenceId: string): boolean => {
  const parts = readPinMediaArtifactPathParts(path);
  return Boolean(parts && parts.referenceSegment === sanitizeInspiredesignPinterestPinMediaReferenceId(referenceId));
};

const sanitizeArtifactPath = (
  value: string | undefined,
  kind: InspiredesignPinterestPinMediaEvidenceKind,
  referenceId: string
): string | undefined => {
  const parts = readPinMediaArtifactPathParts(value);
  if (!parts) return undefined;
  if (parts.referenceSegment !== referenceId) return undefined;
  if (kind === "image" && parts.basename !== PIN_MEDIA_MAIN_BASENAME) return undefined;
  if (kind === "video" && parts.basename !== PIN_MEDIA_VIDEO_BASENAME) return undefined;
  if (kind === "video_poster" && parts.basename !== PIN_MEDIA_POSTER_BASENAME) return undefined;
  return `${PIN_MEDIA_ARTIFACT_ROOT}/${parts.referenceSegment}/${parts.basename}.${parts.extension}`;
};

const pinMediaKindMatchesContentType = (
  kind: InspiredesignPinterestPinMediaEvidenceKind,
  contentType: InspiredesignPinterestPinMediaContentType | undefined
): boolean => {
  if (!contentType) return false;
  if (kind === "video") return contentType === "video/mp4";
  return contentType.startsWith("image/");
};

const hasStrictPinMediaKindArtifactShape = (
  evidence: PinterestPinMediaAuthorityWarningInput,
  referenceId: string,
  path: string
): boolean => {
  if (typeof evidence.kind !== "string" || !isInspiredesignPinterestPinMediaEvidenceKind(evidence.kind)) return false;
  if (typeof evidence.contentType !== "string" || !isPinterestPinMediaEvidenceContentType(evidence.contentType)) return false;
  const sanitizedReferenceId = sanitizeInspiredesignPinterestPinMediaReferenceId(referenceId);
  if (sanitizeArtifactPath(path, evidence.kind, sanitizedReferenceId) !== path) return false;
  return pinMediaKindMatchesContentType(evidence.kind, evidence.contentType)
    && artifactExtensionMatchesContentType(artifactExtension(path), evidence.contentType);
};

export type PinterestPinMediaAuthorityWarningInput = {
  status?: unknown;
  kind?: unknown;
  authority?: unknown;
  referenceId?: unknown;
  url?: unknown;
  sourceUrl?: unknown;
  pinterestPageQuality?: unknown;
  mediaUrl?: unknown;
  path?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  width?: unknown;
  height?: unknown;
  contentType?: unknown;
  warnings?: unknown;
  failure?: unknown;
  rejectionReasons?: unknown;
  tempPath?: unknown;
  firstPartyProvenance?: unknown;
};

const normalizeWarningMarker = (value: string): string => value.toLowerCase().replace(/[\s-]+/g, "_");

const readWarningEntries = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
);

const readProvenanceRecord = (value: unknown): Record<string, unknown> | undefined => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

const isStrictCanonicalByteBackedPinMediaEvidence = (
  evidence: PinterestPinMediaAuthorityWarningInput,
  requireDesignAuthority: boolean
): boolean => {
  const referenceId = typeof evidence.referenceId === "string" ? evidence.referenceId : undefined;
  const path = typeof evidence.path === "string" ? evidence.path : undefined;
  const sourceUrl = typeof evidence.sourceUrl === "string" ? evidence.sourceUrl : undefined;
  const mediaUrl = typeof evidence.mediaUrl === "string" ? evidence.mediaUrl : undefined;
  const canonicalReferenceUrl = typeof evidence.url === "string"
    ? normalizeCanonicalPinterestPinUrl(evidence.url)
    : undefined;
  const canonicalSourceUrl = normalizeCanonicalPinterestPinUrl(sourceUrl);
  const provenance = readProvenanceRecord(evidence.firstPartyProvenance);
  const provenanceReferenceUrl = normalizeCanonicalPinterestPinUrl(provenance?.canonicalReferenceUrl as string | undefined);
  const provenanceSourceUrl = normalizeCanonicalPinterestPinUrl(provenance?.canonicalSourceUrl as string | undefined);
  const hasSerializedIndexContract = requireDesignAuthority
    && evidence.status === undefined
    && evidence.rejectionReasons === undefined
    && evidence.tempPath === undefined;
  const hasCapturedOrIndexedStatus = evidence.status === "captured" || hasSerializedIndexContract;
  return hasCapturedOrIndexedStatus
    && (!requireDesignAuthority || evidence.authority === "design_evidence")
    && typeof referenceId === "string"
    && typeof path === "string"
    && pinMediaArtifactPathMatchesReferenceId(path, referenceId)
    && typeof evidence.sha256 === "string"
    && PINTEREST_PIN_MEDIA_SHA256_HEX_PATTERN.test(evidence.sha256)
    && typeof evidence.bytes === "number"
    && Number.isFinite(evidence.bytes)
    && evidence.bytes >= MIN_PIN_MEDIA_EVIDENCE_BYTES
    && typeof evidence.width === "number"
    && Number.isFinite(evidence.width)
    && evidence.width >= MIN_PIN_MEDIA_EVIDENCE_WIDTH
    && typeof evidence.height === "number"
    && Number.isFinite(evidence.height)
    && evidence.height >= MIN_PIN_MEDIA_EVIDENCE_HEIGHT
    && hasStrictPinMediaKindArtifactShape(evidence, referenceId, path)
    && typeof evidence.failure !== "string"
    && evidence.pinterestPageQuality === PIN_MEDIA_PAGE_QUALITY
    && Boolean(canonicalReferenceUrl && canonicalSourceUrl === canonicalReferenceUrl)
    && Boolean(mediaUrl && isFirstPartyPinterestPinMediaUrl(mediaUrl))
    && Boolean(provenance)
    && provenanceReferenceUrl === canonicalReferenceUrl
    && provenanceSourceUrl === canonicalReferenceUrl
    && provenance?.referenceUrlCanonical === true
    && provenance.sourceUrlMatchesReference === true
    && provenance.mediaUrlFirstParty === true;
};

const hasBlockingWarning = (warnings: readonly string[]): boolean => warnings.some((warning) => {
  const marker = normalizeWarningMarker(warning);
  if (NON_BLOCKING_PIN_MEDIA_WARNING_MARKERS.has(marker)) return false;
  return BLOCKING_WARNING_MARKERS.some((blockingMarker) => marker.includes(blockingMarker));
});

export const hasPinterestPinMediaBlockingWarning = hasBlockingWarning;

const hasAuthorityBlockingWarning = (
  evidence: PinterestPinMediaAuthorityWarningInput,
  requireDesignAuthority: boolean
): boolean => readWarningEntries(evidence.warnings).some((warning) => {
  const marker = normalizeWarningMarker(warning);
  if (NON_BLOCKING_PIN_MEDIA_WARNING_MARKERS.has(marker)) return false;
  if (marker === "interface_chrome_shell" && isStrictCanonicalByteBackedPinMediaEvidence(evidence, requireDesignAuthority)) return false;
  return BLOCKING_WARNING_MARKERS.some((blockingMarker) => marker.includes(blockingMarker));
});

export const hasPinterestPinMediaAuthorityBlockingWarning = (
  evidence: PinterestPinMediaAuthorityWarningInput
): boolean => hasAuthorityBlockingWarning(evidence, true);

const normalizeCanonicalPinterestPinUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const original = new URL(value);
    if (original.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  const normalized = normalizePinterestReferenceUrl(value);
  if (!normalized || !isCanonicalPinterestPinUrl(normalized)) return undefined;
  try {
    const url = new URL(normalized);
    const pinId = url.pathname.match(/^\/pin\/(\d+)\/?$/i)?.[1];
    if (url.protocol !== "https:" || !pinId) return undefined;
    url.hostname = PINTEREST_AUTHORITY_HOST;
    url.pathname = `/pin/${pinId}/`;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
};

const buildFirstPartyProvenance = (
  url: string,
  sourceUrl: string | undefined,
  mediaUrl: string | undefined
): InspiredesignPinterestPinMediaFirstPartyProvenance => {
  const canonicalReferenceUrl = normalizeCanonicalPinterestPinUrl(url);
  const canonicalSourceUrl = normalizeCanonicalPinterestPinUrl(sourceUrl);
  return {
    ...(canonicalReferenceUrl ? { canonicalReferenceUrl } : {}),
    ...(canonicalSourceUrl ? { canonicalSourceUrl } : {}),
    referenceUrlCanonical: Boolean(canonicalReferenceUrl),
    sourceUrlMatchesReference: Boolean(canonicalReferenceUrl && canonicalSourceUrl === canonicalReferenceUrl),
    mediaUrlFirstParty: Boolean(mediaUrl && isFirstPartyPinterestPinMediaUrl(mediaUrl))
  };
};

const addUniqueReason = (reasons: Set<string>, reason: string): void => {
  reasons.add(reason);
};

const collectStructuralRejectionReasons = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence,
  reasons: Set<string>
): void => {
  if (evidence.status !== "captured") addUniqueReason(reasons, `status_${evidence.status}`);
  if (!evidence.path) addUniqueReason(reasons, "missing_artifact_path");
  if (evidence.path && !pinMediaArtifactPathMatchesReferenceId(evidence.path, evidence.referenceId)) {
    addUniqueReason(reasons, "artifact_reference_id_mismatch");
  }
  if (!evidence.sha256) addUniqueReason(reasons, "invalid_sha256");
  if (!evidence.bytes) addUniqueReason(reasons, "missing_bytes");
  if (evidence.bytes !== undefined && evidence.bytes < MIN_PIN_MEDIA_EVIDENCE_BYTES) {
    addUniqueReason(reasons, "bytes_below_minimum");
  }
  if (!evidence.contentType) addUniqueReason(reasons, "unsupported_content_type");
  if (!evidence.width || !evidence.height) addUniqueReason(reasons, "missing_dimensions");
};

const collectProvenanceRejectionReasons = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence,
  reasons: Set<string>
): void => {
  if (!evidence.firstPartyProvenance.referenceUrlCanonical) addUniqueReason(reasons, "invalid_reference_url");
  if (!evidence.sourceUrl) addUniqueReason(reasons, "missing_source_url");
  if (evidence.sourceUrl && !evidence.firstPartyProvenance.sourceUrlMatchesReference) {
    addUniqueReason(reasons, "source_url_mismatch");
  }
  if (!evidence.mediaUrl || !evidence.firstPartyProvenance.mediaUrlFirstParty) {
    addUniqueReason(reasons, "media_url_not_first_party");
  }
  if (evidence.pinterestPageQuality !== PIN_MEDIA_PAGE_QUALITY) {
    addUniqueReason(reasons, "page_quality_not_pin_media");
  }
};

const collectQualityRejectionReasons = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence,
  reasons: Set<string>
): void => {
  if (evidence.width !== undefined && evidence.width < MIN_PIN_MEDIA_EVIDENCE_WIDTH) {
    addUniqueReason(reasons, "dimensions_below_minimum");
  }
  if (evidence.height !== undefined && evidence.height < MIN_PIN_MEDIA_EVIDENCE_HEIGHT) {
    addUniqueReason(reasons, "dimensions_below_minimum");
  }
  if (hasAuthorityBlockingWarning(evidence, false)) addUniqueReason(reasons, "blocking_warning");
};

const buildTrustedPinMediaRoundTripSignature = (
  evidence: Partial<InspiredesignPersistedPinterestPinMediaEvidence>
): string => JSON.stringify({
  status: evidence.status,
  kind: evidence.kind,
  authority: evidence.authority,
  capturedAt: evidence.capturedAt,
  referenceId: evidence.referenceId,
  url: evidence.url,
  sourceUrl: evidence.sourceUrl,
  startedSourceUrl: evidence.startedSourceUrl,
  endedSourceUrl: evidence.endedSourceUrl,
  pinterestPageQuality: evidence.pinterestPageQuality,
  mediaUrl: evidence.mediaUrl,
  path: evidence.path,
  sha256: evidence.sha256,
  bytes: evidence.bytes,
  width: evidence.width,
  height: evidence.height,
  contentType: evidence.contentType,
  candidateSelector: evidence.candidateSelector,
  candidateRole: evidence.candidateRole,
  candidateAlt: evidence.candidateAlt,
  warnings: evidence.warnings,
  failure: evidence.failure,
  rejectionReasons: evidence.rejectionReasons,
  firstPartyProvenance: evidence.firstPartyProvenance
});

const hasTrustedPinMediaRoundTripSignature = (
  evidence: Partial<InspiredesignPersistedPinterestPinMediaEvidence>
): boolean => {
  const signature = (evidence as TrustedPinterestPinMediaRoundTripEvidence)[
    TRUSTED_PIN_MEDIA_ROUND_TRIP_SIGNATURE
  ];
  return typeof signature === "string" && signature === buildTrustedPinMediaRoundTripSignature(evidence);
};

const markTrustedPinMediaRoundTrip = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence
): InspiredesignPersistedPinterestPinMediaEvidence => {
  Object.defineProperty(evidence, TRUSTED_PIN_MEDIA_ROUND_TRIP_SIGNATURE, {
    value: buildTrustedPinMediaRoundTripSignature(evidence),
    enumerable: false
  });
  return evidence;
};

export const classifyInspiredesignPinterestPinMediaAuthority = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence
): Pick<InspiredesignPersistedPinterestPinMediaEvidence, "authority" | "rejectionReasons"> => {
  const reasons = new Set(sanitizeRejectionReasons(evidence.rejectionReasons));
  collectStructuralRejectionReasons(evidence, reasons);
  collectProvenanceRejectionReasons(evidence, reasons);
  collectQualityRejectionReasons(evidence, reasons);
  const rejectionReasons = Array.from(reasons);
  return {
    authority: rejectionReasons.length === 0 ? "design_evidence" : "diagnostic",
    rejectionReasons
  };
};

export const persistInspiredesignPinterestPinMediaEvidence = (
  metadata: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence,
  options: PinterestPinMediaPersistOptions = {}
): InspiredesignPersistedPinterestPinMediaEvidence => {
  const persistedMetadata = metadata as Partial<InspiredesignPersistedPinterestPinMediaEvidence>;
  const status = metadata.status === "skipped" || metadata.status === "failed" ? metadata.status : "captured";
  const kind = isInspiredesignPinterestPinMediaEvidenceKind(metadata.kind) ? metadata.kind : "image";
  const url = sanitizeUrl(metadata.url) ?? "";
  const sourceUrl = sanitizeUrl(metadata.sourceUrl);
  const startedSourceUrl = sanitizeUrl(metadata.startedSourceUrl);
  const endedSourceUrl = sanitizeUrl(metadata.endedSourceUrl);
  const pinterestPageQuality = sanitizePinterestPageQuality(metadata.pinterestPageQuality);
  const mediaUrl = sanitizeFirstPartyMediaUrl(metadata.mediaUrl);
  const referenceId = sanitizeInspiredesignPinterestPinMediaReferenceId(metadata.referenceId);
  const byteInspection = options.buffer ? inspectPinterestPinMediaBuffer(options.buffer) : undefined;
  const sha256 = sanitizeSha256(options.buffer
    ? hashPinterestPinMediaEvidenceBuffer(options.buffer)
    : options.sha256 ?? persistedMetadata.sha256);
  const bytes = sanitizePositiveInteger(options.buffer?.byteLength ?? options.bytes ?? persistedMetadata.bytes);
  const metadataWidth = sanitizePositiveInteger(metadata.width);
  const metadataHeight = sanitizePositiveInteger(metadata.height);
  const metadataContentType = sanitizeContentType(metadata.contentType);
  const width = byteInspection?.width ?? metadataWidth;
  const height = byteInspection?.height ?? metadataHeight;
  const contentType = byteInspection?.contentType ?? metadataContentType;
  const path = status === "captured" ? sanitizeArtifactPath(options.artifactPath ?? persistedMetadata.path, kind, referenceId) : undefined;
  const candidateSelector = sanitizeText(metadata.candidateSelector);
  const candidateRole = sanitizeText(metadata.candidateRole);
  const candidateAlt = sanitizeText(metadata.candidateAlt, MAX_ALT_TEXT_LENGTH);
  const failure = sanitizeText(metadata.failure);
  const isAlreadyFinalizedDesignEvidence = hasTrustedPinMediaRoundTripSignature(persistedMetadata)
    && persistedMetadata.authority === "design_evidence"
    && !options.buffer
    && options.artifactPath === undefined
    && options.sha256 === undefined
    && options.bytes === undefined;
  const evidence: InspiredesignPersistedPinterestPinMediaEvidence = {
    status,
    kind,
    authority: "diagnostic",
    capturedAt: sanitizeCapturedAt(metadata.capturedAt),
    referenceId,
    url,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(startedSourceUrl ? { startedSourceUrl } : {}),
    ...(endedSourceUrl ? { endedSourceUrl } : {}),
    ...(pinterestPageQuality ? { pinterestPageQuality } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(path ? { path } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(bytes ? { bytes } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(contentType ? { contentType } : {}),
    ...(candidateSelector ? { candidateSelector } : {}),
    ...(candidateRole ? { candidateRole } : {}),
    ...(candidateAlt ? { candidateAlt } : {}),
    warnings: sanitizeWarnings(metadata.warnings),
    ...(failure ? { failure } : {}),
    rejectionReasons: sanitizeRejectionReasons(metadata.rejectionReasons),
    firstPartyProvenance: buildFirstPartyProvenance(url, sourceUrl, mediaUrl)
  };
  const byteValidationReasons = new Set(evidence.rejectionReasons);
  if (status === "captured" && !byteInspection && !isAlreadyFinalizedDesignEvidence) {
    byteValidationReasons.add("missing_trusted_byte_inspection");
  }
  if (byteInspection) {
    for (const reason of byteInspection.reasons) {
      byteValidationReasons.add(reason);
    }
    if (metadata.contentType && !metadataContentType) {
      byteValidationReasons.add("unsupported_declared_content_type");
    }
    if (metadataContentType && byteInspection.contentType && metadataContentType !== byteInspection.contentType) {
      byteValidationReasons.add("content_type_mismatch");
    }
    if (metadataWidth !== undefined && byteInspection.width !== undefined && metadataWidth !== byteInspection.width) {
      byteValidationReasons.add("dimension_mismatch");
    }
    if (metadataHeight !== undefined && byteInspection.height !== undefined && metadataHeight !== byteInspection.height) {
      byteValidationReasons.add("dimension_mismatch");
    }
    if (!artifactExtensionMatchesContentType(artifactExtension(path), byteInspection.contentType)) {
      byteValidationReasons.add("artifact_extension_mismatch");
    }
    if (!pinMediaKindMatchesContentType(kind, byteInspection.contentType)) {
      byteValidationReasons.add("kind_content_type_mismatch");
    }
  }
  const evidenceWithByteValidation = {
    ...evidence,
    rejectionReasons: Array.from(byteValidationReasons)
  };
  const classification = classifyInspiredesignPinterestPinMediaAuthority(evidenceWithByteValidation);
  const persisted = { ...evidenceWithByteValidation, ...classification };
  return persisted.authority === "design_evidence" ? markTrustedPinMediaRoundTrip(persisted) : persisted;
};

export const redactDiagnosticPinterestPinMediaEvidence = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence
): InspiredesignPersistedPinterestPinMediaEvidence => {
  if (evidence.authority === "design_evidence") return evidence;
  const redacted = { ...evidence };
  delete redacted.path;
  delete redacted.sha256;
  delete redacted.bytes;
  delete redacted.width;
  delete redacted.height;
  delete redacted.contentType;
  return redacted;
};

export const verifyPinterestPinMediaPersistedBytes = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence,
  buffer: Buffer | undefined
): PinterestPinMediaByteVerification => {
  if (!buffer || buffer.length === 0) return { ok: false, reasons: ["missing_bytes"] };
  const sha256 = hashPinterestPinMediaEvidenceBuffer(buffer);
  const reasons = new Set<string>();
  if (!evidence.sha256 || !PINTEREST_PIN_MEDIA_SHA256_HEX_PATTERN.test(evidence.sha256)) {
    reasons.add("invalid_sha256");
  }
  if (evidence.sha256 && PINTEREST_PIN_MEDIA_SHA256_HEX_PATTERN.test(evidence.sha256) && evidence.sha256 !== sha256) {
    reasons.add("sha256_mismatch");
  }
  if (evidence.bytes !== undefined && evidence.bytes !== buffer.length) reasons.add("byte_count_mismatch");
  if (buffer.length < MIN_PIN_MEDIA_EVIDENCE_BYTES) reasons.add("bytes_below_minimum");
  const rejectionReasons = Array.from(reasons);
  return {
    ok: rejectionReasons.length === 0,
    sha256,
    bytes: buffer.length,
    reasons: rejectionReasons
  };
};

export const buildInspiredesignPinterestPinMediaIndexEntry = (
  evidence: InspiredesignPersistedPinterestPinMediaEvidence
): InspiredesignPinterestPinMediaIndexEntry | undefined => {
  if (evidence.authority !== "design_evidence") return undefined;
  if (!evidence.sourceUrl || !evidence.mediaUrl || !evidence.pinterestPageQuality || !evidence.path || !evidence.sha256) return undefined;
  if (!evidence.bytes || !evidence.width || !evidence.height || !evidence.contentType) return undefined;
  return {
    referenceId: evidence.referenceId,
    url: evidence.url,
    sourceUrl: evidence.sourceUrl,
    mediaUrl: evidence.mediaUrl,
    pinterestPageQuality: evidence.pinterestPageQuality,
    path: evidence.path,
    sha256: evidence.sha256,
    bytes: evidence.bytes,
    width: evidence.width,
    height: evidence.height,
    contentType: evidence.contentType,
    kind: evidence.kind,
    authority: "design_evidence",
    capturedAt: evidence.capturedAt,
    ...(evidence.candidateSelector ? { candidateSelector: evidence.candidateSelector } : {}),
    ...(evidence.candidateRole ? { candidateRole: evidence.candidateRole } : {}),
    ...(evidence.candidateAlt ? { candidateAlt: evidence.candidateAlt } : {}),
    warnings: evidence.warnings,
    firstPartyProvenance: evidence.firstPartyProvenance
  };
};
