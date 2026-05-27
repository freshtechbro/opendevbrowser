import { normalizePinterestReferenceUrl } from "../guidance/recipes/pinterest";
import { isCanonicalPinterestPinUrl } from "./pinterest-media-classification";
import {
  MIN_MOTION_PREVIEW_BYTES,
  MIN_MOTION_REPLAY_BYTES,
  MOTION_EVIDENCE_SHA256_HEX_PATTERN
} from "./motion-evidence";

export type InspiredesignArtifactAuthority = "product_ready" | "diagnostic_only";
export type InspiredesignEvidenceAuthority = "snapshot_ready" | "motion_ready" | "ranked_reference" | "diagnostic_only";

const PINTEREST_AUTHORITY_HOST = "www.pinterest.com";

export type InspiredesignProductReadinessFields = {
  ready: boolean;
  readiness: string;
  harvestReadiness: string;
  productSuccess: boolean;
  artifactAuthority: InspiredesignArtifactAuthority;
  evidenceAuthority: InspiredesignEvidenceAuthority;
  rankedReferenceCount: number;
  authoritativeReferenceCount: number;
  snapshotReadyReferenceCount: number;
  motionReadyReferenceCount: number;
};

export type InspiredesignRankedReferenceAuthorityInput = {
  id?: unknown;
  url?: unknown;
  evidenceAuthority?: unknown;
  capturedVia?: unknown;
};

export type InspiredesignScreenshotAuthorityInput = {
  referenceId?: unknown;
  url?: unknown;
  sourceUrl?: unknown;
  pinterestPageQuality?: unknown;
  path?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  warnings?: unknown;
  failure?: unknown;
};

export type InspiredesignMotionAuthorityInput = {
  referenceId?: unknown;
  url?: unknown;
  motion?: unknown;
};

export type InspiredesignReferenceEvidenceArtifacts = {
  screenshots?: readonly InspiredesignScreenshotAuthorityInput[];
  motions?: readonly InspiredesignMotionAuthorityInput[];
  requireArtifactEvidence?: boolean;
};

const INACTIVE_CANVAS_DO_NOT_PROCEED_CONDITIONS = new Set([
  "planStatus is not accepted"
]);

const RANKED_REFERENCE_CONDITIONAL_BLOCKERS = new Set([
  "rankedReferences is empty",
  "reference_count is 0"
]);

const MISSING_SCREENSHOT_BLOCKER = "screenshot paths are missing when visual evidence was required";
const SNAPSHOT_READY_VISUAL_ARTIFACT_PATH_PATTERN = /^visual-evidence\/[A-Za-z0-9._-]+\/viewport\.png$/;
const GENERIC_VISUAL_ARTIFACT_PATH_PATTERN = /^visual-evidence\/[A-Za-z0-9._-]+\/(?:viewport|full_page)\.png$/;
const MOTION_REPLAY_ARTIFACT_PATH_PATTERN = /^motion-evidence\/[A-Za-z0-9._-]+\/replay\.json$/;
const MOTION_PREVIEW_ARTIFACT_PATH_PATTERN = /^motion-evidence\/[A-Za-z0-9._-]+\/preview\.png$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const MIN_SNAPSHOT_READY_VISUAL_BYTES = 1024;
const PINTEREST_PIN_MEDIA_PAGE_QUALITY = "pin_media";
const SNAPSHOT_BLOCKING_WARNING_MARKERS = [
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
  "controls_only"
] as const;

const readRecord = (value: unknown): Record<string, unknown> | undefined => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

const normalizeUrlForAuthority = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

export const isInspiredesignPinterestOwnedReferenceUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "pinterest.com" || hostname.endsWith(".pinterest.com");
  } catch {
    return false;
  }
};

export const isInspiredesignPinterestPinReferenceUrl = (value: unknown): boolean => (
  typeof value === "string" && isCanonicalPinterestPinUrl(value)
);

const normalizePinterestPinUrlForAuthority = (value: unknown): string | undefined => {
  if (!isInspiredesignPinterestPinReferenceUrl(value)) return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = normalizePinterestReferenceUrl(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    url.hostname = PINTEREST_AUTHORITY_HOST;
    return url.href.replace(/\/$/, "");
  } catch {
    return normalized.replace(/\/$/, "");
  }
};

const sameAuthorityReference = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  artifact: { referenceId?: unknown; url?: unknown }
): boolean => {
  if (typeof reference.id === "string" && reference.id.length > 0 && artifact.referenceId === reference.id) return true;
  const referencePinterestPinUrl = normalizePinterestPinUrlForAuthority(reference.url);
  const artifactPinterestPinUrl = normalizePinterestPinUrlForAuthority(artifact.url);
  if (referencePinterestPinUrl && artifactPinterestPinUrl) {
    return referencePinterestPinUrl === artifactPinterestPinUrl;
  }
  const referenceUrl = normalizeUrlForAuthority(reference.url);
  const artifactUrl = normalizeUrlForAuthority(artifact.url);
  return Boolean(referenceUrl && artifactUrl && referenceUrl === artifactUrl);
};

const warningText = (value: unknown): string => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").join(" ").toLowerCase()
    : ""
);

const normalizedWarningText = (value: unknown): string => (
  warningText(value).replace(/[\s-]+/g, "_")
);

const hasBlockingArtifactWarning = (value: unknown): boolean => {
  const text = normalizedWarningText(value);
  return SNAPSHOT_BLOCKING_WARNING_MARKERS.some((marker) => text.includes(marker));
};

const hasPinterestAuthoritySourceMatch = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  sourceUrl: unknown
): boolean => {
  const referenceUrl = normalizePinterestPinUrlForAuthority(reference.url);
  const capturedUrl = normalizePinterestPinUrlForAuthority(sourceUrl);
  return Boolean(referenceUrl && capturedUrl && referenceUrl === capturedUrl);
};

const hasPinterestMotionStableSourceProvenance = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  motion: Record<string, unknown>
): boolean => {
  const referenceUrl = normalizePinterestPinUrlForAuthority(reference.url);
  const sourceUrl = normalizePinterestPinUrlForAuthority(motion.sourceUrl);
  const startedSourceUrl = normalizePinterestPinUrlForAuthority(motion.startedSourceUrl);
  const endedSourceUrl = normalizePinterestPinUrlForAuthority(motion.endedSourceUrl);
  return Boolean(
    referenceUrl
    && sourceUrl
    && startedSourceUrl
    && endedSourceUrl
    && sourceUrl === referenceUrl
    && startedSourceUrl === referenceUrl
    && endedSourceUrl === referenceUrl
  );
};

const hasGenericMotionStableSourceProvenance = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  motion: Record<string, unknown>
): boolean => {
  const referenceUrl = normalizeUrlForAuthority(reference.url);
  const sourceUrl = normalizeUrlForAuthority(motion.sourceUrl);
  const startedSourceUrl = normalizeUrlForAuthority(motion.startedSourceUrl);
  const endedSourceUrl = normalizeUrlForAuthority(motion.endedSourceUrl);
  return Boolean(
    referenceUrl
    && sourceUrl
    && startedSourceUrl
    && endedSourceUrl
    && sourceUrl === referenceUrl
    && startedSourceUrl === referenceUrl
    && endedSourceUrl === referenceUrl
  );
};

const hasGenericVisualSourceProvenance = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  screenshot: InspiredesignScreenshotAuthorityInput
): boolean => {
  const referenceUrl = normalizeUrlForAuthority(reference.url);
  const sourceUrl = normalizeUrlForAuthority(screenshot.sourceUrl);
  return Boolean(referenceUrl && sourceUrl && sourceUrl === referenceUrl);
};

const hasPinterestPinMediaPageQuality = (value: unknown): boolean => value === PINTEREST_PIN_MEDIA_PAGE_QUALITY;

const hasPinterestMotionPinMediaPageQuality = (motion: Record<string, unknown>): boolean => (
  hasPinterestPinMediaPageQuality(motion.pinterestPageQuality)
  && hasPinterestPinMediaPageQuality(motion.startedPinterestPageQuality)
  && hasPinterestPinMediaPageQuality(motion.endedPinterestPageQuality)
);

const hasUsableVisualArtifactShape = (
  screenshot: InspiredesignScreenshotAuthorityInput,
  pathPattern: RegExp,
  minBytes: number
): boolean => (
  typeof screenshot.path === "string"
  && pathPattern.test(screenshot.path)
  && typeof screenshot.sha256 === "string"
  && SHA256_HEX_PATTERN.test(screenshot.sha256)
  && typeof screenshot.bytes === "number"
  && Number.isFinite(screenshot.bytes)
  && screenshot.bytes >= minBytes
  && typeof screenshot.failure !== "string"
  && !hasBlockingArtifactWarning(screenshot.warnings)
);

const hasScreenshotArtifactForReference = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  screenshots: readonly InspiredesignScreenshotAuthorityInput[] = []
): boolean => screenshots.some((screenshot) => (
  sameAuthorityReference(reference, screenshot)
  && hasPinterestAuthoritySourceMatch(reference, screenshot.sourceUrl)
  && hasPinterestPinMediaPageQuality(screenshot.pinterestPageQuality)
  && hasUsableVisualArtifactShape(
    screenshot,
    SNAPSHOT_READY_VISUAL_ARTIFACT_PATH_PATTERN,
    MIN_SNAPSHOT_READY_VISUAL_BYTES
  )
));

const hasGenericVisualArtifactForReference = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  screenshots: readonly InspiredesignScreenshotAuthorityInput[] = []
): boolean => screenshots.some((screenshot) => (
  sameAuthorityReference(reference, screenshot)
  && hasGenericVisualSourceProvenance(reference, screenshot)
  && hasUsableVisualArtifactShape(screenshot, GENERIC_VISUAL_ARTIFACT_PATH_PATTERN, 1)
));

const hasUsableMotionFileShape = (
  file: Record<string, unknown> | undefined,
  pathPattern: RegExp,
  minBytes: number
): boolean => (
  typeof file?.path === "string"
  && pathPattern.test(file.path)
  && typeof file.sha256 === "string"
  && MOTION_EVIDENCE_SHA256_HEX_PATTERN.test(file.sha256)
  && typeof file.bytes === "number"
  && Number.isFinite(file.bytes)
  && file.bytes >= minBytes
);

const hasMotionArtifactForReference = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  motions: readonly InspiredesignMotionAuthorityInput[] = []
): boolean => motions.some((entry) => {
  if (!sameAuthorityReference(reference, entry)) return false;
  const motion = readRecord(entry.motion);
  const replay = readRecord(motion?.replay);
  const preview = readRecord(motion?.preview);
  return motion?.status === "captured"
    && motion.authority === "design_evidence"
    && motion.diagnostic === false
    && Array.isArray(motion.diagnosticReasons)
    && motion.diagnosticReasons.length === 0
    && hasPinterestMotionStableSourceProvenance(reference, motion)
    && hasPinterestMotionPinMediaPageQuality(motion)
    && typeof motion.failure !== "string"
    && !hasBlockingArtifactWarning(motion.warnings)
    && typeof motion.frameCount === "number"
    && motion.frameCount > 0
    && hasUsableMotionFileShape(replay, MOTION_REPLAY_ARTIFACT_PATH_PATTERN, MIN_MOTION_REPLAY_BYTES)
    && hasUsableMotionFileShape(preview, MOTION_PREVIEW_ARTIFACT_PATH_PATTERN, MIN_MOTION_PREVIEW_BYTES);
});

const hasGenericMotionArtifactForReference = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  motions: readonly InspiredesignMotionAuthorityInput[] = []
): boolean => motions.some((entry) => {
  if (!sameAuthorityReference(reference, entry)) return false;
  const motion = readRecord(entry.motion);
  const replay = readRecord(motion?.replay);
  const preview = readRecord(motion?.preview);
  return motion?.status === "captured"
    && motion.authority === "design_evidence"
    && motion.diagnostic === false
    && Array.isArray(motion.diagnosticReasons)
    && motion.diagnosticReasons.length === 0
    && hasGenericMotionStableSourceProvenance(reference, motion)
    && typeof motion.failure !== "string"
    && typeof motion.frameCount === "number"
    && motion.frameCount > 0
    && hasUsableMotionFileShape(replay, MOTION_REPLAY_ARTIFACT_PATH_PATTERN, MIN_MOTION_REPLAY_BYTES)
    && hasUsableMotionFileShape(preview, MOTION_PREVIEW_ARTIFACT_PATH_PATTERN, MIN_MOTION_PREVIEW_BYTES);
});

const readReadiness = (record: Record<string, unknown>): string | undefined => {
  const directReadiness = record.readiness;
  if (typeof directReadiness === "string" && directReadiness.length > 0) return directReadiness;
  const directGuidance = readRecord(record.nextStepGuidance);
  const directGuidanceReadiness = directGuidance?.readiness;
  if (typeof directGuidanceReadiness === "string" && directGuidanceReadiness.length > 0) return directGuidanceReadiness;
  const meta = readRecord(record.meta);
  const metaGuidance = readRecord(meta?.nextStepGuidance);
  const metaReadiness = metaGuidance?.readiness;
  return typeof metaReadiness === "string" && metaReadiness.length > 0 ? metaReadiness : undefined;
};

const readArrayCount = (value: unknown): number | undefined => (Array.isArray(value) ? value.length : undefined);

const readFiniteCount = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
);

const readRankedReferenceCount = (record: Record<string, unknown>): number => {
  const responseReferences = readArrayCount(record.rankedReferences);
  if (typeof responseReferences === "number") return responseReferences;
  const meta = readRecord(record.meta);
  const metaReferences = readArrayCount(meta?.rankedReferences);
  if (typeof metaReferences === "number") return metaReferences;
  return readFiniteCount(record.rankedReferenceCount)
    ?? readFiniteCount(meta?.rankedReferenceCount)
    ?? 0;
};

const readEvidenceAuthority = (value: unknown): InspiredesignEvidenceAuthority | undefined => {
  if (
    value === "snapshot_ready"
    || value === "motion_ready"
    || value === "ranked_reference"
    || value === "diagnostic_only"
  ) return value;
  return undefined;
};

const readArtifactAuthority = (value: unknown): InspiredesignArtifactAuthority | undefined => {
  if (value === "product_ready" || value === "diagnostic_only") return value;
  return undefined;
};

type InspiredesignReadinessCounts = Pick<
  InspiredesignProductReadinessFields,
  "rankedReferenceCount"
  | "authoritativeReferenceCount"
  | "snapshotReadyReferenceCount"
  | "motionReadyReferenceCount"
>;

type InspiredesignReadinessCountKey = keyof InspiredesignReadinessCounts;

const READINESS_COUNT_KEYS: readonly InspiredesignReadinessCountKey[] = [
  "rankedReferenceCount",
  "authoritativeReferenceCount",
  "snapshotReadyReferenceCount",
  "motionReadyReferenceCount"
];

const hasOwnRecordValue = (record: Record<string, unknown>, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
);

const hasMalformedReadinessCount = (record: Record<string, unknown>): boolean => (
  READINESS_COUNT_KEYS.some((key) => hasOwnRecordValue(record, key) && readFiniteCount(record[key]) === undefined)
);

const hasMalformedExplicitReadinessCount = (data: Record<string, unknown>): boolean => {
  if (hasMalformedReadinessCount(data)) return true;
  const meta = readRecord(data.meta);
  return meta ? hasMalformedReadinessCount(meta) : false;
};

const readExplicitRankedReferenceCount = (data: Record<string, unknown>): number => {
  const meta = readRecord(data.meta);
  return readArrayCount(data.rankedReferences)
    ?? readArrayCount(meta?.rankedReferences)
    ?? readFiniteCount(data.rankedReferenceCount)
    ?? readFiniteCount(meta?.rankedReferenceCount)
    ?? 0;
};

const readCompleteReadinessCountsFromRecord = (
  record: Record<string, unknown>
): InspiredesignReadinessCounts | undefined => {
  const rankedReferenceCount = readArrayCount(record.rankedReferences) ?? readFiniteCount(record.rankedReferenceCount);
  const authoritativeReferenceCount = readFiniteCount(record.authoritativeReferenceCount);
  const snapshotReadyReferenceCount = readFiniteCount(record.snapshotReadyReferenceCount);
  const motionReadyReferenceCount = readFiniteCount(record.motionReadyReferenceCount);
  return rankedReferenceCount !== undefined
    && authoritativeReferenceCount !== undefined
    && snapshotReadyReferenceCount !== undefined
    && motionReadyReferenceCount !== undefined
    ? {
      rankedReferenceCount,
      authoritativeReferenceCount,
      snapshotReadyReferenceCount,
      motionReadyReferenceCount
    }
    : undefined;
};

const readCompleteExplicitReadinessCounts = (
  data: Record<string, unknown>
): InspiredesignReadinessCounts | undefined => {
  const directCounts = readCompleteReadinessCountsFromRecord(data);
  if (directCounts) return directCounts;
  const meta = readRecord(data.meta);
  return meta ? readCompleteReadinessCountsFromRecord(meta) : undefined;
};

const hasCoherentReadinessCounts = (counts: InspiredesignReadinessCounts): boolean => (
  counts.authoritativeReferenceCount <= counts.rankedReferenceCount
  && counts.snapshotReadyReferenceCount <= counts.rankedReferenceCount
  && counts.motionReadyReferenceCount <= counts.rankedReferenceCount
  && counts.snapshotReadyReferenceCount + counts.motionReadyReferenceCount <= counts.authoritativeReferenceCount
);

const coerceReadinessCount = (value: number): number => readFiniteCount(value) ?? 0;

const clampReadinessCounts = (counts: InspiredesignReadinessCounts): InspiredesignReadinessCounts => {
  const rankedReferenceCount = coerceReadinessCount(counts.rankedReferenceCount);
  const authoritativeReferenceCount = Math.min(
    rankedReferenceCount,
    coerceReadinessCount(counts.authoritativeReferenceCount)
  );
  const snapshotReadyReferenceCount = Math.min(
    authoritativeReferenceCount,
    coerceReadinessCount(counts.snapshotReadyReferenceCount)
  );
  const remainingAuthorityCount = authoritativeReferenceCount - snapshotReadyReferenceCount;
  const motionReadyReferenceCount = Math.min(
    remainingAuthorityCount,
    coerceReadinessCount(counts.motionReadyReferenceCount)
  );
  return {
    rankedReferenceCount,
    authoritativeReferenceCount,
    snapshotReadyReferenceCount,
    motionReadyReferenceCount
  };
};

export const readExplicitInspiredesignProductReadinessFields = (
  data: Record<string, unknown>
): InspiredesignProductReadinessFields | undefined => {
  if (typeof data.productSuccess !== "boolean") return undefined;
  const artifactAuthority = readArtifactAuthority(data.artifactAuthority);
  const evidenceAuthority = readEvidenceAuthority(data.evidenceAuthority);
  if (!artifactAuthority || !evidenceAuthority) return undefined;
  const malformedExplicitCount = hasMalformedExplicitReadinessCount(data);
  const explicitCounts = readCompleteExplicitReadinessCounts(data);
  const claimsProductReady = data.productSuccess || artifactAuthority === "product_ready" || evidenceAuthority !== "diagnostic_only";
  if (explicitCounts) {
    const explicitReady = typeof data.ready === "boolean" ? data.ready : undefined;
    const readiness = readReadiness(data) ?? (explicitReady === true ? "ready" : "unknown");
    const ready = readiness === "ready" && explicitReady !== false;
    const derivedFields = deriveInspiredesignProductReadinessFields(data);
    const explicitCountsCoherent = hasCoherentReadinessCounts(explicitCounts);
    const explicitCountsMatchArtifacts = READINESS_COUNT_KEYS.every((key) => explicitCounts[key] === derivedFields[key]);
    const productSuccess = data.productSuccess
      && artifactAuthority === "product_ready"
      && evidenceAuthority !== "diagnostic_only"
      && ready
      && explicitCounts.rankedReferenceCount > 0
      && explicitCountsCoherent
      && explicitCountsMatchArtifacts
      && derivedFields.productSuccess
      && derivedFields.artifactAuthority === "product_ready"
      && derivedFields.evidenceAuthority === evidenceAuthority
      && !malformedExplicitCount;
    return {
      ready,
      readiness,
      harvestReadiness: typeof data.harvestReadiness === "string" && data.harvestReadiness.length > 0
        ? data.harvestReadiness
        : readiness,
      productSuccess,
      artifactAuthority: productSuccess ? artifactAuthority : "diagnostic_only",
      evidenceAuthority: productSuccess ? evidenceAuthority : "diagnostic_only",
      ...explicitCounts
    };
  }
  if (claimsProductReady) {
    const derivedFields = deriveInspiredesignProductReadinessFields(data);
    return malformedExplicitCount
      ? {
        ...derivedFields,
        productSuccess: false,
        artifactAuthority: "diagnostic_only",
        evidenceAuthority: "diagnostic_only"
      }
      : derivedFields;
  }
  const readiness = readReadiness(data) ?? "unknown";
  const rankedReferenceCount = readExplicitRankedReferenceCount(data);
  const meta = readRecord(data.meta);
  return {
    ready: typeof data.ready === "boolean" ? data.ready : readiness === "ready",
    readiness,
    harvestReadiness: typeof data.harvestReadiness === "string" && data.harvestReadiness.length > 0
      ? data.harvestReadiness
      : readiness,
    productSuccess: data.productSuccess,
    artifactAuthority,
    evidenceAuthority,
    rankedReferenceCount,
    authoritativeReferenceCount: readFiniteCount(data.authoritativeReferenceCount)
      ?? readFiniteCount(meta?.authoritativeReferenceCount)
      ?? readAuthoritativeReferenceCount(data),
    snapshotReadyReferenceCount: readFiniteCount(data.snapshotReadyReferenceCount)
      ?? readFiniteCount(meta?.snapshotReadyReferenceCount)
      ?? readSnapshotReadyReferenceCount(data),
    motionReadyReferenceCount: readFiniteCount(data.motionReadyReferenceCount)
      ?? readFiniteCount(meta?.motionReadyReferenceCount)
      ?? readMotionReadyReferenceCount(data)
  };
};

export const isInspiredesignAuthoritativeRankedReference = (
  reference: InspiredesignRankedReferenceAuthorityInput,
  artifacts: InspiredesignReferenceEvidenceArtifacts = {}
): boolean => {
  const normalizedUrl = normalizeUrlForAuthority(reference.url);
  if (!normalizedUrl) return false;
  if (isInspiredesignPinterestOwnedReferenceUrl(reference.url)) {
    if (!isPinterestRankedReference(reference)) return false;
  } else {
    return hasGenericVisualArtifactForReference(reference, artifacts.screenshots)
      || hasGenericMotionArtifactForReference(reference, artifacts.motions);
  }
  const authority = readEvidenceAuthority(reference.evidenceAuthority);
  if (authority === "snapshot_ready") {
    return hasScreenshotArtifactForReference(reference, artifacts.screenshots);
  }
  if (authority === "motion_ready") {
    return hasMotionArtifactForReference(reference, artifacts.motions);
  }
  return false;
};

const rankedReferencesFromRecord = (record: Record<string, unknown>): unknown[] => {
  const meta = readRecord(record.meta);
  if (Array.isArray(record.rankedReferences)) return record.rankedReferences;
  if (Array.isArray(meta?.rankedReferences)) return meta.rankedReferences;
  return [];
};

const readSnapshotReadyReferenceCount = (record: Record<string, unknown>): number => {
  const rankedReferences = rankedReferencesFromRecord(record);
  if (rankedReferences.length > 0) {
    return rankedReferences.filter((reference) => {
      const rankedReference = readRecord(reference);
      return rankedReference
        ? (
          readEvidenceAuthority(rankedReference.evidenceAuthority) === "snapshot_ready"
          || !isInspiredesignPinterestOwnedReferenceUrl(rankedReference.url)
        ) && isInspiredesignAuthoritativeRankedReference(rankedReference, {
          screenshots: readScreenshotArtifactsFromRecord(record)
        })
        : false;
    }).length;
  }
  return 0;
};

const readMotionReadyReferenceCount = (record: Record<string, unknown>): number => {
  const rankedReferences = rankedReferencesFromRecord(record);
  if (rankedReferences.length > 0) {
    return rankedReferences.filter((reference) => {
      const rankedReference = readRecord(reference);
      return rankedReference
        ? (
          readEvidenceAuthority(rankedReference.evidenceAuthority) === "motion_ready"
          || !isInspiredesignPinterestOwnedReferenceUrl(rankedReference.url)
        ) && isInspiredesignAuthoritativeRankedReference(rankedReference, {
          motions: readMotionArtifactsFromRecord(record)
        })
        : false;
    }).length;
  }
  return 0;
};

const readAuthoritativeReferenceCount = (record: Record<string, unknown>): number => {
  const rankedReferences = rankedReferencesFromRecord(record);
  if (rankedReferences.length > 0) {
    const requireArtifactEvidence = readPinterestEvidenceRequired(record) || rankedReferences.some((reference) => {
      const rankedReference = readRecord(reference);
      return rankedReference ? isPinterestRankedReference(rankedReference) : false;
    });
    return rankedReferences.filter((reference) => {
      const rankedReference = readRecord(reference);
      return rankedReference
        ? isInspiredesignAuthoritativeRankedReference(rankedReference, {
          screenshots: readScreenshotArtifactsFromRecord(record),
          motions: readMotionArtifactsFromRecord(record),
          requireArtifactEvidence
        })
        : false;
    }).length;
  }
  return 0;
};

const readMissingScreenshotCount = (record: Record<string, unknown>): number | undefined => {
  const direct = record.missingScreenshotCount;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const quality = readRecord(record.qualitySummary) ?? readRecord(record.quality);
  const qualityCount = quality?.missingScreenshotCount;
  if (typeof qualityCount === "number" && Number.isFinite(qualityCount)) return qualityCount;
  const meta = readRecord(record.meta);
  const metaQuality = readRecord(meta?.qualitySummary) ?? readRecord(meta?.quality);
  const metaQualityCount = metaQuality?.missingScreenshotCount;
  if (typeof metaQualityCount === "number" && Number.isFinite(metaQualityCount)) return metaQualityCount;
  const metrics = readRecord(record.metrics) ?? readRecord(meta?.metrics);
  const metricCount = metrics?.missing_screenshot_count;
  return typeof metricCount === "number" && Number.isFinite(metricCount) ? metricCount : undefined;
};

const isPinterestRankedReference = (reference: Record<string, unknown>): boolean => {
  return isInspiredesignPinterestPinReferenceUrl(reference.url);
};

const hasValidRankedReferenceUrl = (reference: Record<string, unknown>): boolean => {
  return Boolean(normalizeUrlForAuthority(reference.url));
};

const readScreenshotArtifactsFromRecord = (
  record: Record<string, unknown>
): InspiredesignScreenshotAuthorityInput[] => {
  if (Array.isArray(record.screenshotIndex)) return record.screenshotIndex.filter(readRecord);
  const meta = readRecord(record.meta);
  return Array.isArray(meta?.screenshotIndex) ? meta.screenshotIndex.filter(readRecord) : [];
};

const readMotionArtifactsFromRecord = (
  record: Record<string, unknown>
): InspiredesignMotionAuthorityInput[] => {
  if (Array.isArray(record.motionEvidence)) return record.motionEvidence.filter(readRecord);
  const meta = readRecord(record.meta);
  return Array.isArray(meta?.motionEvidence) ? meta.motionEvidence.filter(readRecord) : [];
};

const readNonPinterestRankedReferenceCount = (record: Record<string, unknown>): number | undefined => {
  const rankedReferences = rankedReferencesFromRecord(record);
  if (rankedReferences.length === 0) return undefined;
  return rankedReferences.filter((reference) => {
    const rankedReference = readRecord(reference);
      return rankedReference && hasValidRankedReferenceUrl(rankedReference)
      ? !isInspiredesignPinterestOwnedReferenceUrl(rankedReference.url)
      : false;
  }).length;
};

const readPinterestRankedReferenceCount = (record: Record<string, unknown>): number | undefined => {
  const rankedReferences = rankedReferencesFromRecord(record);
  if (rankedReferences.length === 0) return undefined;
  return rankedReferences.filter((reference) => {
    const rankedReference = readRecord(reference);
    return rankedReference ? isPinterestRankedReference(rankedReference) : false;
  }).length;
};

const readPinterestEvidenceRequired = (record: Record<string, unknown>): boolean => {
  const direct = record.pinterestEvidenceRequired;
  if (typeof direct === "boolean") return direct;
  const meta = readRecord(record.meta);
  return meta?.pinterestEvidenceRequired === true;
};

const readDoNotProceedIf = (record: Record<string, unknown>): string[] => {
  const direct = record.doNotProceedIf;
  if (Array.isArray(direct)) return direct.filter((entry): entry is string => typeof entry === "string");
  const directGuidance = readRecord(record.nextStepGuidance);
  const guidanceConditions = directGuidance?.doNotProceedIf;
  if (Array.isArray(guidanceConditions)) {
    return guidanceConditions.filter((entry): entry is string => typeof entry === "string");
  }
  const meta = readRecord(record.meta);
  const metaGuidance = readRecord(meta?.nextStepGuidance);
  const metaConditions = metaGuidance?.doNotProceedIf;
  return Array.isArray(metaConditions) ? metaConditions.filter((entry): entry is string => typeof entry === "string") : [];
};

export const isInactiveInspiredesignCanvasDoNotProceedCondition = (
  condition: string,
  rankedReferenceCount: number,
  missingScreenshotCount?: number
): boolean => {
  const normalized = condition.trim();
  if (INACTIVE_CANVAS_DO_NOT_PROCEED_CONDITIONS.has(normalized)) return true;
  if (normalized === MISSING_SCREENSHOT_BLOCKER) {
    return rankedReferenceCount > 0 && missingScreenshotCount === 0;
  }
  return rankedReferenceCount > 0 && RANKED_REFERENCE_CONDITIONAL_BLOCKERS.has(normalized);
};

export const hasActiveInspiredesignCanvasDoNotProceedBlocker = (
  conditions: readonly string[],
  rankedReferenceCount: number,
  missingScreenshotCount?: number
): boolean => conditions.some((condition) => (
  !isInactiveInspiredesignCanvasDoNotProceedCondition(condition, rankedReferenceCount, missingScreenshotCount)
));

const evidenceAuthorityFromCounts = (args: {
  productSuccess: boolean;
  snapshotReadyReferenceCount: number;
  motionReadyReferenceCount: number;
}): InspiredesignEvidenceAuthority => {
  if (!args.productSuccess) return "diagnostic_only";
  if (args.snapshotReadyReferenceCount > 0) return "snapshot_ready";
  if (args.motionReadyReferenceCount > 0) return "motion_ready";
  return "ranked_reference";
};

export const buildInspiredesignProductReadinessFields = (
  readinessValue: string | undefined,
  rankedReferenceCount: number,
  nonPinterestRankedReferenceCount = 0,
  pinterestRankedReferenceCount = Math.max(0, rankedReferenceCount - nonPinterestRankedReferenceCount),
  activeDoNotProceedBlocker = false,
  snapshotReadyReferenceCount = 0,
  motionReadyReferenceCount = 0,
  authoritativeReferenceCount = Math.min(
    rankedReferenceCount,
    snapshotReadyReferenceCount + motionReadyReferenceCount
  ),
  pinterestEvidenceRequired = false
): InspiredesignProductReadinessFields => {
  const readiness = readinessValue && readinessValue.length > 0 ? readinessValue : "unknown";
  const ready = readiness === "ready";
  const rawCounts = {
    rankedReferenceCount,
    authoritativeReferenceCount,
    snapshotReadyReferenceCount,
    motionReadyReferenceCount
  };
  const countsAreNonnegativeIntegers = READINESS_COUNT_KEYS.every((key) => readFiniteCount(rawCounts[key]) !== undefined);
  const countsAreCoherent = countsAreNonnegativeIntegers && hasCoherentReadinessCounts(rawCounts);
  const counts = clampReadinessCounts(rawCounts);
  const nonPinterestCount = coerceReadinessCount(nonPinterestRankedReferenceCount);
  const pinterestCount = coerceReadinessCount(pinterestRankedReferenceCount);
  const allRankedReferencesHaveAuthority = counts.authoritativeReferenceCount >= counts.rankedReferenceCount;
  const artifactReadyReferenceCount = counts.snapshotReadyReferenceCount + counts.motionReadyReferenceCount;
  const hasProductReadyEvidenceAuthority = artifactReadyReferenceCount > 0;
  const hasRequiredPinterestAuthority = !pinterestEvidenceRequired
    || (pinterestCount > 0 && artifactReadyReferenceCount > 0);
  const rankedReferenceKindsFitTotal = nonPinterestCount + pinterestCount <= counts.rankedReferenceCount;
  const productSuccess = ready
    && counts.rankedReferenceCount > 0
    && !activeDoNotProceedBlocker
    && countsAreCoherent
    && rankedReferenceKindsFitTotal
    && allRankedReferencesHaveAuthority
    && hasProductReadyEvidenceAuthority
    && hasRequiredPinterestAuthority;
  const evidenceAuthority = evidenceAuthorityFromCounts({
    productSuccess,
    snapshotReadyReferenceCount: counts.snapshotReadyReferenceCount,
    motionReadyReferenceCount: counts.motionReadyReferenceCount
  });
  return {
    ready,
    readiness,
    harvestReadiness: readiness,
    productSuccess,
    artifactAuthority: productSuccess ? "product_ready" : "diagnostic_only",
    evidenceAuthority,
    ...counts
  };
};

export const deriveInspiredesignProductReadinessFields = (
  data: Record<string, unknown>
): InspiredesignProductReadinessFields => {
  const rankedReferences = rankedReferencesFromRecord(data);
  const pinterestEvidenceRequired = readPinterestEvidenceRequired(data);
  const lacksRankedReferenceRecords = rankedReferences.length === 0;
  const rankedReferenceCount = readRankedReferenceCount(data);
  return buildInspiredesignProductReadinessFields(
    readReadiness(data),
    rankedReferenceCount,
    readNonPinterestRankedReferenceCount(data),
    readPinterestRankedReferenceCount(data),
    hasActiveInspiredesignCanvasDoNotProceedBlocker(
      readDoNotProceedIf(data),
      rankedReferenceCount,
      readMissingScreenshotCount(data)
    ),
    lacksRankedReferenceRecords ? 0 : readSnapshotReadyReferenceCount(data),
    lacksRankedReferenceRecords ? 0 : readMotionReadyReferenceCount(data),
    lacksRankedReferenceRecords ? 0 : readAuthoritativeReferenceCount(data),
    pinterestEvidenceRequired
  );
};
