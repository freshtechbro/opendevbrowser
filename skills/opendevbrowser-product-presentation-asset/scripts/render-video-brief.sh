#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: render-video-brief.sh <manifest-json> [output-dir]" >&2
  exit 1
fi

manifest="$1"
outdir="${2:-$(dirname "$manifest")}"
mkdir -p "$outdir"

node - "$manifest" "$outdir" <<'NODE'
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const manifestPath = process.argv[2];
const outdir = process.argv[3];
const manifestDir = path.dirname(manifestPath);
const readinessArtifactPath = path.join(manifestDir, "presentation-readiness.json");
const productArtifactPath = path.join(manifestDir, "product.json");
const copyArtifactPath = path.join(manifestDir, "copy.md");
const featuresArtifactPath = path.join(manifestDir, "features.md");

const READINESS_SEVERITY = { pass: 0, partial: 1, fail: 2 };
const SUPPORTED_STATUSES = new Set(Object.keys(READINESS_SEVERITY));
const BLOCKING_PASS_REASON_CODES = new Set([
  "missing_visual_assets",
  "insufficient_clean_feature_evidence",
  "copy_omitted_by_request",
  "copy_generation_blocked",
  "title_fallback_used",
  "readiness_invalid",
  "readiness_missing",
  "readiness_review_required",
  "readiness_surface_mismatch"
]);
const SUPPORTED_REASON_CODES = new Set([
  ...BLOCKING_PASS_REASON_CODES,
  "marketplace_chrome_rejected",
  "site_chrome_rejected",
  "positive_spec_promoted",
  "unsupported_claim_rejected",
  "raw_fragment_rejected",
  "selected_record_changed",
  "title_fallback_used"
]);
const RAW_FRAGMENT_LABEL_THRESHOLD = 2;
const CONTENT_BOUNDARY_LABELS = [
  "Type",
  "Maximum DPI",
  "Connectivity",
  "Features",
  "Brand",
  "Model",
  "MPN",
  "Color",
  "Product Identifiers",
  "Product Key Features",
  "Additional Product Features",
  "Manufacturer",
  "Item Length",
  "Tracking Method",
  "Charger Included",
  "Country of Origin",
  "Condition",
  "Quantity",
  "Seller",
  "Returns",
  "Shipping",
  "Buy It Now",
  "Category breadcrumb",
  "About this product",
  "Item description from the seller",
  "About this seller",
  "Item Width",
  "Item Height",
  "Number of Buttons"
];
const SUPPORTED_CONTENT_BOUNDARY_LABELS = new Set(["Type", "Maximum DPI", "Connectivity", "Features"]);
const MARKETPLACE_CHROME_PATTERNS = [
  /\b(?:qty|quantity)\b/i,
  /\bcondition\s*:/i,
  /\bnew:\s*a brand-new\b/i,
  /\bmay not ship\b/i,
  /\bship(?:ping)?\b/i,
  /\bseller\b|\bfeedback\b/i,
  /\bbuy it now\b|\badd to cart\b|\bcheckout\b|\bwatchlist\b/i,
  /\breturns?\b|\breturn policy\b/i,
  /\bpackaging\b|\bunopened\b|\bundamaged\b/i
];
const SITE_CHROME_EXACT_TEXTS = new Set([
  "accessibility",
  "accessories",
  "airtag and accessories",
  "all products",
  "apple account and password",
  "apple trade in",
  "apple watch",
  "apple watch bands",
  "apple vision pro",
  "airpods",
  "billing and subscriptions",
  "billing & subscriptions",
  "browse all",
  "business",
  "cases and protection",
  "cases & protection",
  "certified refurbished",
  "charging essentials",
  "check coverage",
  "community",
  "creative tools",
  "education",
  "entertainment",
  "financing",
  "find a store",
  "gaming",
  "genius bar",
  "get applecare",
  "get help",
  "government",
  "headphones and speakers",
  "headphones & speakers",
  "health and fitness",
  "health & fitness",
  "helpful topics",
  "home office",
  "ipad",
  "iphone",
  "local nav close menu",
  "local nav open menu",
  "mac",
  "magsafe",
  "mice and keyboards",
  "mice & keyboards",
  "new arrivals",
  "order status",
  "other country or region",
  "personal setup",
  "photography",
  "quick links",
  "repair",
  "shop the latest",
  "smart home accessories",
  "software",
  "storage",
  "support",
  "tech specs",
  "store",
  "tv and home",
  "tv & home",
  "veterans and military",
  "vision",
  "watch"
]);
const SITE_CHROME_PATTERNS = [
  /^(?:all products|browse all|find a store|order status|quick links|shop the latest|tech specs)$/i,
  /^(?:explore|shop|compare|support|get help)\s+[a-z0-9][\w\s&+\-]{0,60}$/i,
  /^(?:australia|brazil|brasil|canada|china|france|germany|hong kong|india|italy|japan|mexico|new zealand|singapore|south korea|spain|taiwan|united kingdom|united states)\s+\([^)]{2,40}\)$/iu,
  /\b(?:local nav|find a store|order status|certified refurbished|apple trade in)\b/i
];
const STACKED_SITE_CHROME_LABEL_THRESHOLD = 3;
const UNSUPPORTED_CLAIM_PATTERNS = [
  /\b(?:number one|#1|guaranteed|guarantees)\b/i,
  /\bbest\b[^.!?]{0,80}\bever\b/i,
  /\b(?:cure|cures|clinically proven|medical grade)\b/i,
  /\b(?:lifetime warranty|free returns?|risk-free)\b/i
];
const IDENTITY_UNSUPPORTED_CLAIM_PATTERNS = [
  /\b(?:number one|#1|guaranteed|guarantees)\b/i,
  /\b(?:cure|cures|clinically proven|medical grade)\b/i,
  /\b(?:lifetime warranty|free returns?|risk-free)\b/i
];
const UNSUPPORTED_STANDALONE_BEST_CLAIM_RE = /\bbest\b(?!\s+buy\b)/i;
const STRONG_RAW_FRAGMENT_LABELS = new Set([
  "Maximum DPI",
  "MPN",
  "Condition",
  "Quantity",
  "Seller",
  "Returns",
  "Shipping",
  "Buy It Now",
  "Item Length",
  "Item Width",
  "Item Height",
  "Tracking Method",
  "Number of Buttons",
  "Charger Included",
  "Country of Origin"
]);
const BOOLEAN_SPEC_FRAGMENT_VALUE_RE = /\bcharger\s+included\s+(?:yes|no)\b/iu;
const COLONLESS_RAW_FRAGMENT_LABEL_THRESHOLD = 3;
const MIN_PASS_PROMOTED_CLAIMS = 3;
const MIN_PASS_EVIDENCE_DIMENSIONS = 2;

function invalidReadinessSummary(message) {
  return {
    status: "fail",
    warnings: [message],
    reasonCodes: ["readiness_invalid"],
    criteria: []
  };
}

function invalidReadinessArtifact(message) {
  return {
    presentationReadiness: invalidReadinessSummary(`presentation readiness schema is invalid at presentation-readiness.json: ${message}`),
    productVideoReadiness: invalidReadinessSummary(`productVideo readiness schema is invalid at presentation-readiness.json: ${message}`)
  };
}

function invalidProductArtifact(message) {
  return {
    presentationReadiness: invalidReadinessSummary(`presentation readiness schema is invalid at product.json: ${message}`),
    productVideoReadiness: invalidReadinessSummary(`productVideo readiness schema is invalid at product.json: ${message}`)
  };
}

function readRequiredJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manifest not found: ${filePath}`);
  }
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Manifest must be a JSON object: ${filePath}`);
  }
  return value;
}

function readOptionalJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return invalidReadinessArtifact("file must be a JSON object");
    }
    if (!("presentationReadiness" in value) || !("productVideoReadiness" in value)) {
      return invalidReadinessArtifact("file must include presentationReadiness and productVideoReadiness");
    }
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalidReadinessArtifact(`file could not be parsed: ${message}`);
  }
}

function readOptionalProductJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return invalidProductArtifact("product.json is required");
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return invalidProductArtifact("file must be a JSON object");
    }
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalidProductArtifact(`file could not be parsed: ${message}`);
  }
}

function readOptionalTextFile(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, "utf8");
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

function normalizeProductVideoText(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function unescapeProductVideoMarkdownText(value) {
  return String(value).replace(/\\([\\`*_{}\[\]()#+!|>~])/g, "$1");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMarketplaceChromeText(value) {
  const normalized = normalizeProductVideoText(value);
  return MARKETPLACE_CHROME_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSiteChromeText(value) {
  const normalized = normalizeProductVideoText(value);
  const key = normalized.toLowerCase().replace(/[.!?]+$/u, "");
  return SITE_CHROME_EXACT_TEXTS.has(key)
    || SITE_CHROME_PATTERNS.some((pattern) => pattern.test(normalized))
    || containsStackedSiteChromeLabels(normalized);
}

function containsStackedSiteChromeLabels(value) {
  let count = 0;
  for (const label of SITE_CHROME_EXACT_TEXTS) {
    if (!new RegExp(`\\b${escapeRegex(label)}\\b`, "iu").test(value)) continue;
    count += 1;
    if (count >= STACKED_SITE_CHROME_LABEL_THRESHOLD) return true;
  }
  return false;
}

function isRawSpecFragmentText(value) {
  const normalized = normalizeProductVideoText(value);
  if (BOOLEAN_SPEC_FRAGMENT_VALUE_RE.test(normalized)) return true;
  const boundaryLabel = leadingContentBoundaryLabel(normalized);
  if (boundaryLabel && (contentBoundaryHeading(normalized) || !SUPPORTED_CONTENT_BOUNDARY_LABELS.has(boundaryLabel))) {
    return true;
  }
  let punctuatedLabelCount = 0;
  let colonlessLabelCount = 0;
  let hasStrongColonlessLabel = false;
  for (const label of CONTENT_BOUNDARY_LABELS) {
    const punctuatedPattern = new RegExp(`\\b${escapeRegex(label)}\\b\\s*[:\\-]`, "i");
    const colonlessPattern = new RegExp(`(?:^|\\s)${escapeRegex(label)}\\b(?=\\s+\\S)`, "iu");
    if (punctuatedPattern.test(normalized)) punctuatedLabelCount += 1;
    if (colonlessPattern.test(normalized)) {
      colonlessLabelCount += 1;
      if (STRONG_RAW_FRAGMENT_LABELS.has(label)) hasStrongColonlessLabel = true;
    }
    if (punctuatedLabelCount >= RAW_FRAGMENT_LABEL_THRESHOLD) return true;
    if (colonlessLabelCount >= COLONLESS_RAW_FRAGMENT_LABEL_THRESHOLD) return true;
    if (colonlessLabelCount >= RAW_FRAGMENT_LABEL_THRESHOLD && hasStrongColonlessLabel) return true;
  }
  return false;
}

function leadingContentBoundaryLabel(value) {
  const normalized = normalizeProductVideoText(value);
  return CONTENT_BOUNDARY_LABELS.find((label) => new RegExp(`^${escapeRegex(label)}\\b`, "iu").test(normalized));
}

function contentBoundaryHeading(value) {
  const normalized = normalizeProductVideoText(value).replace(/[.!?]+$/u, "");
  return CONTENT_BOUNDARY_LABELS.some((label) => normalized.toLowerCase() === label.toLowerCase());
}

function isPublicArtifactField(field) {
  return !field.endsWith(".title") && !field.endsWith(".brand");
}

function isUnsupportedClaimText(value) {
  const normalized = normalizeProductVideoText(value);
  return UNSUPPORTED_STANDALONE_BEST_CLAIM_RE.test(normalized)
    || UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isUnsupportedIdentityText(value) {
  const normalized = normalizeProductVideoText(value);
  return UNSUPPORTED_STANDALONE_BEST_CLAIM_RE.test(normalized)
    || IDENTITY_UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized));
}

function publicFieldLeak(value, field = "") {
  const normalized = normalizeProductVideoText(value);
  if (!normalized) return undefined;
  if (isMarketplaceChromeText(normalized)) return "marketplace_chrome_rejected";
  if (isSiteChromeText(normalized)) return "site_chrome_rejected";
  if (isPublicArtifactField(field) && leadingContentBoundaryLabel(normalized)) return "raw_fragment_rejected";
  if (isRawSpecFragmentText(normalized)) return "raw_fragment_rejected";
  if (field.endsWith(".title") || field.endsWith(".brand")) {
    return isUnsupportedIdentityText(normalized) ? "unsupported_claim_rejected" : undefined;
  }
  if (isUnsupportedClaimText(normalized)) return "unsupported_claim_rejected";
  return undefined;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isReadinessObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isReadinessCriterion(value) {
  return isReadinessObject(value)
    && typeof value.label === "string"
    && typeof value.observed === "string"
    && typeof value.threshold === "string"
    && typeof value.passed === "boolean";
}

function isCriterionArray(value) {
  return Array.isArray(value) && value.every(isReadinessCriterion);
}

function hasPassCleanBenefitCriterion(criteria) {
  return criteria.some((entry) => (
    entry.label.trim() === "Clean benefit evidence"
    && entry.passed === true
    && /promoted claim\(s\)/i.test(entry.observed)
    && /evidence dimension\(s\)/i.test(entry.observed)
    && /promoted product benefit claims/i.test(entry.threshold)
    && /evidence dimension\(s\)/i.test(entry.threshold)
  ));
}

function readReadinessStatus(value) {
  return isReadinessObject(value) && typeof value.status === "string" ? value.status : undefined;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function markdownPublicLines(content) {
  return content.split(/\r?\n/u)
    .map((line) => normalizeProductVideoText(unescapeProductVideoMarkdownText(line.replace(/^#+\s*/u, "").replace(/^[-*]\s*/u, "").replace(/^Product:\s*/iu, ""))))
    .filter(Boolean);
}

function publicMarkdownFindings(fileName, content) {
  if (content === undefined) {
    return [{ field: fileName, reasonCode: "readiness_missing", missing: true }];
  }
  return markdownPublicLines(content)
    .map((line, index) => ({
      field: `${fileName}:${index + 1}`,
      reasonCode: publicFieldLeak(line, fileName)
    }))
    .filter((entry) => entry.reasonCode);
}

function readinessSchemaError(value) {
  if (!isReadinessObject(value)) return "readiness value must be an object";
  if (!isStringArray(value.warnings)) return "warnings must be a string array";
  if (!isStringArray(value.reasonCodes)) return "reasonCodes must be a string array";
  if (!isCriterionArray(value.criteria)) return "criteria must contain readiness criterion objects";
  if (normalizeStringArray(value.warnings).some((entry) => publicFieldLeak(entry))) return "warnings cannot contain marketplace, site chrome, unsupported, or raw spec text";
  if (normalizeStringArray(value.reasonCodes).some((entry) => !SUPPORTED_REASON_CODES.has(entry))) return "reasonCodes must use supported readiness reason codes";
  if (value.status === "pass" && value.criteria.length === 0) return "pass readiness must include criteria";
  if (value.status === "pass" && !hasPassCleanBenefitCriterion(value.criteria)) return "pass readiness must include the Clean benefit evidence criterion";
  if (value.status === "pass" && value.criteria.some((entry) => entry.passed === false)) return "pass readiness cannot contain failed criteria";
  if (value.status === "pass" && value.reasonCodes.some((entry) => BLOCKING_PASS_REASON_CODES.has(entry))) return "pass readiness cannot contain blocking reason codes";
  return undefined;
}

function normalizeReadiness(value, label, location) {
  if (value === undefined) {
    return {
      status: "partial",
      warnings: [`${label} readiness was not present`],
      reasonCodes: ["readiness_missing"],
      criteria: []
    };
  }
  const schemaError = readinessSchemaError(value);
  if (schemaError) {
    return {
      status: "fail",
      warnings: [`${label} readiness schema is invalid at ${location}: ${schemaError}`],
      reasonCodes: ["readiness_invalid"],
      criteria: []
    };
  }
  const status = readReadinessStatus(value);
  if (!status || !SUPPORTED_STATUSES.has(status)) {
    return {
      status: "fail",
      warnings: [`${label} readiness status is invalid at ${location}`],
      reasonCodes: ["readiness_invalid"],
      criteria: []
    };
  }
  const warnings = normalizeStringArray(value.warnings);
  const reasonCodes = normalizeStringArray(value.reasonCodes);
  return {
    status,
    warnings: warnings.length > 0 ? warnings : status === "pass" ? [] : [`${label} readiness requires review`],
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : status === "pass" ? [] : ["readiness_review_required"],
    criteria: value.criteria
  };
}

function unique(values) {
  return Array.from(new Set(values));
}

function sortedStrings(values) {
  return unique(values).sort((left, right) => left.localeCompare(right));
}

function normalizedCriterion(value) {
  return {
    label: value.label,
    observed: value.observed,
    threshold: value.threshold,
    passed: value.passed
  };
}

function stableReadinessSummary(value) {
  return JSON.stringify({
    status: value.status,
    warnings: sortedStrings(value.warnings),
    reasonCodes: sortedStrings(value.reasonCodes),
    criteria: (value.criteria || []).map(normalizedCriterion).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  });
}

function combineReadiness(presentation, productVideo) {
  const status = READINESS_SEVERITY[productVideo.status] > READINESS_SEVERITY[presentation.status]
    ? productVideo.status
    : presentation.status;
  return {
    status,
    warnings: unique([...presentation.warnings, ...productVideo.warnings]),
    reasonCodes: unique([...presentation.reasonCodes, ...productVideo.reasonCodes])
  };
}

function resolveReadiness(label, surfaces) {
  const present = surfaces.filter((surface) => surface.value !== undefined);
  const missingRequired = surfaces.filter((surface) => surface.required && surface.value === undefined);
  if (present.length === 0) {
    const missing = normalizeReadiness(undefined, label, "none");
    if (missingRequired.length === 0) return missing;
    return {
      status: "fail",
      warnings: unique([
        ...missing.warnings,
        ...missingRequired.map((surface) => `${surface.location} is missing`)
      ]),
      reasonCodes: unique([...missing.reasonCodes, "readiness_missing"])
    };
  }
  const normalized = present.map((surface) => normalizeReadiness(surface.value, label, surface.location));
  const resolved = normalized.reduce((worst, entry) => (
    READINESS_SEVERITY[entry.status] > READINESS_SEVERITY[worst.status] ? entry : worst
  ));
  const statuses = unique(normalized.map((entry) => entry.status));
  const surfaceStatuses = unique(present.map((surface) => `${surface.location}:${readReadinessStatus(surface.value) || "invalid"}`));
  const surfaceStructures = unique(normalized.map(stableReadinessSummary));
  const hasStructureMismatch = surfaceStructures.length > 1;
  const mismatchWarnings = [];
  if (statuses.length > 1) {
    mismatchWarnings.push(`${label} readiness surfaces disagree: ${surfaceStatuses.join(", ")}`);
  } else if (hasStructureMismatch) {
    mismatchWarnings.push(`${label} readiness surfaces differ structurally after stable normalization`);
  }
  const mismatchReasonCodes = statuses.length > 1 || hasStructureMismatch ? ["readiness_surface_mismatch"] : [];
  const missingRequiredWarnings = missingRequired.map((surface) => `${surface.location} is missing`);
  const missingRequiredReasonCodes = missingRequired.length > 0 ? ["readiness_missing"] : [];
  return {
    status: missingRequired.length > 0 || statuses.length > 1 || hasStructureMismatch ? "fail" : resolved.status,
    warnings: unique([...normalized.flatMap((entry) => entry.warnings), ...missingRequiredWarnings, ...mismatchWarnings]),
    reasonCodes: unique([
      ...normalized.flatMap((entry) => entry.reasonCodes),
      ...missingRequiredReasonCodes,
      ...mismatchReasonCodes
    ])
  };
}

function resolveSidecarSummaryReadiness(readinessArtifact, presentation, productVideo) {
  const location = "presentation-readiness.json.summary.status";
  const summary = readinessArtifact.summary;
  if (!isReadinessObject(summary)) {
    return {
      status: "fail",
      warnings: [`${location} is missing`],
      reasonCodes: ["readiness_missing"]
    };
  }
  const status = readReadinessStatus(summary);
  if (!status || !SUPPORTED_STATUSES.has(status)) {
    return {
      status: "fail",
      warnings: [`${location} is invalid`],
      reasonCodes: ["readiness_invalid"]
    };
  }
  const surfaceStatuses = [
    `${location}:${status}`,
    `presentation-readiness.json.presentationReadiness:${presentation.status}`,
    `presentation-readiness.json.productVideoReadiness:${productVideo.status}`
  ];
  if (status !== presentation.status || status !== productVideo.status) {
    return {
      status: "fail",
      warnings: [`summary readiness surfaces disagree: ${surfaceStatuses.join(", ")}`],
      reasonCodes: ["readiness_surface_mismatch"]
    };
  }
  return {
    status,
    warnings: [],
    reasonCodes: []
  };
}

function evidenceReferenceSchemaError(value) {
  if (!isReadinessObject(value)) return "evidence reference must be an object";
  if (!isNonEmptyString(value.source)) return "evidence reference source is required";
  if (!isNonEmptyString(value.path)) return "evidence reference path is required";
  if (!isNonEmptyString(value.label)) return "evidence reference label is required";
  if ("excerpt" in value && !isNonEmptyString(value.excerpt)) return "evidence reference excerpt must be a non-empty string when present";
  return undefined;
}

function promotedClaimSchemaError(value) {
  if (!isReadinessObject(value)) return "promoted claim must be an object";
  if (!isNonEmptyString(value.claim)) return "promoted claim text is required";
  if (!isNonEmptyString(value.specKey)) return "promoted claim specKey is required";
  if (!isNonEmptyString(value.specLabel)) return "promoted claim specLabel is required";
  if (!isNonEmptyString(value.specValue)) return "promoted claim specValue is required";
  if (value.reasonCode !== "positive_spec_promoted") return "promoted claim reasonCode must be positive_spec_promoted";
  if (!Array.isArray(value.evidenceReferences) || value.evidenceReferences.length === 0) return "promoted claim evidenceReferences are required";
  return value.evidenceReferences.map(evidenceReferenceSchemaError).find(Boolean);
}

function rejectedCandidateSchemaError(value) {
  if (!isReadinessObject(value)) return "rejected candidate must be an object";
  if (!isNonEmptyString(value.source)) return "rejected candidate source is required";
  if (!isNonEmptyString(value.reasonCode)) return "rejected candidate reasonCode is required";
  if (!isNonEmptyString(value.reason)) return "rejected candidate reason is required";
  if (!isNonEmptyString(value.candidateHash)) return "rejected candidate hash is required";
  if (!isNonNegativeNumber(value.evidenceReferenceCount)) return "rejected candidate evidenceReferenceCount is required";
  if (!Array.isArray(value.evidenceReferences)) return "rejected candidate evidenceReferences array is required";
  if (value.evidenceReferences.length !== value.evidenceReferenceCount) return "rejected candidate evidenceReferenceCount must match evidenceReferences length";
  return value.evidenceReferences.map(evidenceReferenceSchemaError).find(Boolean);
}

function candidateSummarySchemaError(value) {
  if (!isReadinessObject(value)) return "candidate summary must be an object";
  if (!isNonNegativeNumber(value.cleanSpecCount)) return "candidate summary cleanSpecCount is required";
  if (!isNonNegativeNumber(value.rejectedCandidateCount)) return "candidate summary rejectedCandidateCount is required";
  if ("recordId" in value && !isNonEmptyString(value.recordId)) return "candidate summary recordId must be non-empty when present";
  if ("provider" in value && !isNonEmptyString(value.provider)) return "candidate summary provider must be non-empty when present";
  if ("title" in value && !isNonEmptyString(value.title)) return "candidate summary title must be non-empty when present";
  return undefined;
}

function firstArrayEntrySchemaError(arrayValue, schemaError, label) {
  if (!Array.isArray(arrayValue)) return `${label} must be an array`;
  const index = arrayValue.findIndex((entry) => schemaError(entry));
  if (index === -1) return undefined;
  return `${label}[${index}] ${schemaError(arrayValue[index])}`;
}

function summaryCountWarning(summary, field, expected) {
  if (!isNonNegativeNumber(summary?.[field])) return `presentation-readiness.json.summary.${field} must be a non-negative number`;
  return summary[field] === expected
    ? undefined
    : `presentation-readiness.json.summary.${field} expected ${expected} but found ${summary[field]}`;
}

function sidecarCompletenessWarnings(args) {
  const artifact = args.readinessArtifact;
  const warnings = [];
  if (!isNonEmptyString(artifact.selectedRecordId)) warnings.push("presentation-readiness.json.selectedRecordId is required");
  if (!isNonEmptyString(artifact.originalPrimaryRecordId)) warnings.push("presentation-readiness.json.originalPrimaryRecordId is required");
  const summary = artifact.summary;
  if (!isReadinessObject(summary)) {
    warnings.push("presentation-readiness.json.summary must be an object");
  } else {
    warnings.push(
      summaryCountWarning(summary, "promotedFeatureCount", args.featureCount),
      summaryCountWarning(summary, "promotedClaimCount", args.promotedClaims.length),
      summaryCountWarning(summary, "rejectedCandidateCount", args.rejectedCandidates.length),
      summaryCountWarning(summary, "evidenceReferenceCount", args.evidenceReferences.length),
      summaryCountWarning(summary, "imageCount", args.imageCount),
      summaryCountWarning(summary, "screenshotCount", args.screenshotCount)
    );
  }
  warnings.push(
    firstArrayEntrySchemaError(artifact.candidateSummaries, candidateSummarySchemaError, "presentation-readiness.json.candidateSummaries"),
    firstArrayEntrySchemaError(artifact.promotedClaims, promotedClaimSchemaError, "presentation-readiness.json.promotedClaims"),
    firstArrayEntrySchemaError(artifact.rejectedCandidates, rejectedCandidateSchemaError, "presentation-readiness.json.rejectedCandidates"),
    firstArrayEntrySchemaError(artifact.evidenceReferences, evidenceReferenceSchemaError, "presentation-readiness.json.evidenceReferences")
  );
  if (Array.isArray(artifact.candidateSummaries) && artifact.candidateSummaries.length === 0) {
    warnings.push("presentation-readiness.json.candidateSummaries must include at least one candidate summary");
  }
  const promotedEvidenceCount = args.promotedClaims.reduce((count, claim) => (
    count + (Array.isArray(claim.evidenceReferences) ? claim.evidenceReferences.length : 0)
  ), 0);
  if (args.evidenceReferences.length !== promotedEvidenceCount) {
    warnings.push(`presentation-readiness.json.evidenceReferences expected ${promotedEvidenceCount} promoted-claim evidence reference(s) but found ${args.evidenceReferences.length}`);
  }
  return warnings.filter(Boolean);
}

function formatList(values, fallback) {
  return values.length > 0 ? values.join(", ") : fallback;
}

function pickVisual(...candidates) {
  return candidates.find((entry) => typeof entry === "string" && entry.length > 0) || noVisualAsset;
}

function isRemoteAssetPath(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function existingManifestAssetPath(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalizeProductVideoText(value);
  if (isRemoteAssetPath(normalized)) return undefined;
  const candidatePath = path.isAbsolute(normalized) ? normalized : path.join(manifestDir, normalized);
  try {
    return fs.statSync(candidatePath).isFile() ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function tableCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function normalizedJson(value) {
  return JSON.stringify(value ?? null);
}

function hashClaim(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function hasIdentityFields(entry) {
  return typeof entry.specValue === "string"
    && typeof entry.claimHash === "string"
    && typeof entry.claimLength === "number"
    && typeof entry.specValueHash === "string"
    && typeof entry.specValueLength === "number";
}

function exactSummaryIdentityMatches(entry) {
  return hasIdentityFields(entry)
    && entry.claimHash === hashClaim(entry.claim)
    && entry.claimLength === entry.claim.length
    && entry.specValueHash === hashClaim(entry.specValue)
    && entry.specValueLength === entry.specValue.length;
}

function publicStringDrift(field, manifestValue, productValue) {
  if (!(field in productArtifact)) return [];
  return normalizeProductVideoText(manifestValue || "") === normalizeProductVideoText(productValue || "")
    ? []
    : [`product.json.${field} differs from manifest.product.${field}`];
}

function publicFeatureDrift(manifestFeatures, productFeatures) {
  if (!("features" in productArtifact)) return [];
  const left = normalizeStringArray(manifestFeatures);
  const right = normalizeStringArray(productFeatures);
  return normalizedJson(left) === normalizedJson(right)
    ? []
    : ["product.json.features differs from manifest.product.features"];
}

function publicPriceDrift(manifestPrice, productPrice) {
  if (!("price" in productArtifact)) return [];
  return normalizedJson(manifestPrice) === normalizedJson(productPrice)
    ? []
    : ["product.json.price differs from manifest.product.price"];
}

function publicProductDriftFindings(manifestValue, productValue) {
  if (!hasProductArtifactFields) return [];
  return [
    ...publicStringDrift("title", manifestValue.title, productValue.title),
    ...publicStringDrift("brand", manifestValue.brand, productValue.brand),
    ...publicStringDrift("copy", manifestValue.copy, productValue.copy),
    ...publicFeatureDrift(manifestValue.features, productValue.features),
    ...publicPriceDrift(manifestValue.price, productValue.price)
  ];
}

const data = readRequiredJsonFile(manifestPath);
const readinessArtifact = readOptionalJsonFile(readinessArtifactPath);
const productArtifact = readOptionalProductJsonFile(productArtifactPath);
const copyArtifactMarkdown = readOptionalTextFile(copyArtifactPath);
const featuresArtifactMarkdown = readOptionalTextFile(featuresArtifactPath);
const manifestProduct = data.product || {};
const hasProductArtifactFields = Object.keys(productArtifact).some((key) => (
  key !== "presentationReadiness" && key !== "productVideoReadiness"
));
const product = hasProductArtifactFields ? { ...manifestProduct, ...productArtifact } : manifestProduct;
const pricing = product.price || {};
const presentationReadiness = resolveReadiness("presentation", [
  { location: "manifest.readiness.presentation", value: data?.readiness?.presentation, required: true },
  { location: "manifest.product.presentationReadiness", value: manifestProduct.presentationReadiness },
  { location: "product.json.presentationReadiness", value: productArtifact.presentationReadiness, required: true },
  { location: "presentation-readiness.json.presentationReadiness", value: readinessArtifact.presentationReadiness, required: true }
]);
const productVideoReadiness = resolveReadiness("productVideo", [
  { location: "manifest.readiness.productVideo", value: data?.readiness?.productVideo, required: true },
  { location: "manifest.product.productVideoReadiness", value: manifestProduct.productVideoReadiness },
  { location: "product.json.productVideoReadiness", value: productArtifact.productVideoReadiness, required: true },
  { location: "presentation-readiness.json.productVideoReadiness", value: readinessArtifact.productVideoReadiness, required: true }
]);
const sidecarSummaryReadiness = resolveSidecarSummaryReadiness(readinessArtifact, presentationReadiness, productVideoReadiness);
let readiness = combineReadiness(combineReadiness(presentationReadiness, productVideoReadiness), sidecarSummaryReadiness);

let title = product.title || "Unknown product";
const hasKnownBrand = typeof product.brand === "string" && product.brand.trim() && product.brand.trim().toLowerCase() !== "unknown";
let brand = hasKnownBrand ? product.brand : "Unknown brand";
const amount = typeof pricing.amount === "number" ? pricing.amount.toFixed(2) : "N/A";
const currency = pricing.currency || "USD";
const fullFeatures = Array.isArray(product.features) ? product.features.filter((entry) => typeof entry === "string") : [];
const fullCopy = typeof product.copy === "string" ? product.copy.trim() : "";
let features = fullFeatures.slice(0, 5);
let copy = fullCopy.slice(0, 600);
const listedImages = Array.isArray(data?.assets?.images) ? data.assets.images : [];
const listedScreenshots = Array.isArray(data?.assets?.screenshots) ? data.assets.screenshots : [];
const images = listedImages.map(existingManifestAssetPath).filter(Boolean);
const screenshots = listedScreenshots.map(existingManifestAssetPath).filter(Boolean);
const rawEvidence = Array.isArray(data?.assets?.raw) ? data.assets.raw : [];
const noVisualAsset = "metadata-only-pack:no-captured-visual";
const hasVisuals = images.length > 0 || screenshots.length > 0;
const promotedClaims = Array.isArray(readinessArtifact.promotedClaims)
  ? readinessArtifact.promotedClaims.filter((entry) => (
    entry
    && typeof entry === "object"
    && typeof entry.claim === "string"
    && typeof entry.reasonCode === "string"
  ))
  : [];
const rejectedCandidates = Array.isArray(readinessArtifact.rejectedCandidates) ? readinessArtifact.rejectedCandidates : [];
const sidecarEvidenceReferences = Array.isArray(readinessArtifact.evidenceReferences) ? readinessArtifact.evidenceReferences : [];

function isBoundedClaimSummary(entry) {
  return typeof entry.claim === "string" && (entry.claim.endsWith("...") || entry.claim.endsWith("…"));
}

function boundedClaimIdentityMatches(entry, claim) {
  if (!isBoundedClaimSummary(entry)) return false;
  return hasIdentityFields(entry)
    && entry.claimHash === hashClaim(claim)
    && entry.claimLength === claim.length;
}

function promotedClaimMatchesFeature(entry, claim) {
  return entry.claim === claim || boundedClaimIdentityMatches(entry, claim);
}

function promotedClaimFor(claim, index) {
  const matchingClaim = promotedClaims.find((entry) => (
    promotedClaimMatchesFeature(entry, claim)
  ));
  return readiness.status === "pass" ? matchingClaim : matchingClaim || promotedClaims[index];
}

function promotedClaimHasEvidence(promotedClaim) {
  return Array.isArray(promotedClaim?.evidenceReferences)
    && promotedClaim.evidenceReferences.some((entry) => (
      entry
      && typeof entry.source === "string"
      && typeof entry.path === "string"
      && typeof entry.label === "string"
      && typeof entry.excerpt === "string"
      && entry.source.trim().length > 0
      && entry.path.trim().length > 0
      && entry.label.trim().length > 0
      && entry.excerpt.trim().length > 0
      && !publicFieldLeak(entry.excerpt)
    ));
}

function promotedClaimIdentityMatches(promotedClaim, claim) {
  if (!promotedClaim) return false;
  return isBoundedClaimSummary(promotedClaim)
    ? boundedClaimIdentityMatches(promotedClaim, claim)
    : promotedClaim.claim === claim && exactSummaryIdentityMatches(promotedClaim);
}

function passPromotedEvidenceWarning() {
  if (readiness.status !== "pass") return undefined;
  if (fullFeatures.length === 0) return "pass readiness requires feature claims backed by presentation-readiness.json";
  const supportedClaims = promotedClaims.filter((entry) => (
    entry.reasonCode === "positive_spec_promoted"
    && promotedClaimHasEvidence(entry)
  ));
  const evidenceDimensions = new Set(supportedClaims.map((entry) => entry.specKey).filter(Boolean));
  if (supportedClaims.length < MIN_PASS_PROMOTED_CLAIMS || evidenceDimensions.size < MIN_PASS_EVIDENCE_DIMENSIONS) {
    return `pass readiness requires at least ${MIN_PASS_PROMOTED_CLAIMS} promotedClaims across ${MIN_PASS_EVIDENCE_DIMENSIONS} evidence dimensions in presentation-readiness.json`;
  }
  const missingEvidence = fullFeatures.some((claim, index) => {
    const promotedClaim = promotedClaimFor(claim, index);
    return promotedClaim?.reasonCode !== "positive_spec_promoted"
      || !promotedClaimIdentityMatches(promotedClaim, claim)
      || !promotedClaimHasEvidence(promotedClaim);
  });
  return missingEvidence ? "pass readiness requires promotedClaims with evidence references in presentation-readiness.json" : undefined;
}

function passVisualAssetsWarning() {
  if (readiness.status !== "pass" || hasVisuals) return undefined;
  return "pass readiness requires at least one existing image or screenshot asset";
}

function expectedEvidenceBackedCopy() {
  if (fullFeatures.length === 0) return "";
  return `${title} presentation highlights verified product details: ${fullFeatures.slice(0, 3).join(" ")}`;
}

function productCopyMatchesEvidence() {
  const expectedCopy = normalizeProductVideoText(expectedEvidenceBackedCopy());
  const actualCopy = normalizeProductVideoText(fullCopy);
  if (!expectedCopy || actualCopy !== expectedCopy) return false;
  return fullFeatures.slice(0, 3).every((claim, index) => {
    const promotedClaim = promotedClaimFor(claim, index);
    return promotedClaim?.reasonCode === "positive_spec_promoted"
      && promotedClaimIdentityMatches(promotedClaim, claim)
      && promotedClaimHasEvidence(promotedClaim);
  });
}

function passCopyEvidenceWarning() {
  if (readiness.status !== "pass" || productCopyMatchesEvidence()) return undefined;
  return "pass readiness requires product.copy to match evidence-backed promotedClaims";
}

const promotedEvidenceWarning = passPromotedEvidenceWarning();
const visualAssetsWarning = passVisualAssetsWarning();
const copyEvidenceWarning = passCopyEvidenceWarning();
const sidecarCompletenessWarningList = sidecarCompletenessWarnings({
  readinessArtifact,
  featureCount: fullFeatures.length,
  promotedClaims,
  rejectedCandidates,
  evidenceReferences: sidecarEvidenceReferences,
  imageCount: listedImages.length,
  screenshotCount: listedScreenshots.length
});
if (promotedEvidenceWarning || visualAssetsWarning || copyEvidenceWarning || sidecarCompletenessWarningList.length > 0) {
  readiness = {
    status: "fail",
    warnings: unique([
      ...readiness.warnings,
      ...(promotedEvidenceWarning ? [promotedEvidenceWarning] : []),
      ...(visualAssetsWarning ? [visualAssetsWarning] : []),
      ...(copyEvidenceWarning ? [copyEvidenceWarning] : []),
      ...sidecarCompletenessWarningList
    ]),
    reasonCodes: unique([
      ...readiness.reasonCodes,
      "readiness_invalid",
      ...(visualAssetsWarning ? ["missing_visual_assets"] : [])
    ])
  };
}

function publicFieldEntriesForProduct(label, value) {
  const entries = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return entries;
  entries.push({ field: `${label}.title`, value: value.title });
  entries.push({ field: `${label}.brand`, value: value.brand });
  entries.push({ field: `${label}.copy`, value: value.copy });
  for (const [index, feature] of normalizeStringArray(value.features).entries()) {
    entries.push({ field: `${label}.features.${index}`, value: feature });
  }
  return entries;
}

const publicFieldFindings = [
  ...publicFieldEntriesForProduct("manifest.product", manifestProduct),
  ...(hasProductArtifactFields ? publicFieldEntriesForProduct("product.json", productArtifact) : [])
].map((entry) => ({ ...entry, reasonCode: publicFieldLeak(entry.value, entry.field) })).filter((entry) => entry.reasonCode);
const publicMarkdownFindingsList = readiness.status === "pass"
  ? [
    ...publicMarkdownFindings("copy.md", copyArtifactMarkdown),
    ...publicMarkdownFindings("features.md", featuresArtifactMarkdown)
  ]
  : [];
const publicDriftFindings = publicProductDriftFindings(manifestProduct, productArtifact);
if (publicFieldFindings.length > 0 || publicMarkdownFindingsList.length > 0 || publicDriftFindings.length > 0) {
  const titleLeaked = publicFieldFindings.some((entry) => entry.field.endsWith(".title"));
  const brandLeaked = publicFieldFindings.some((entry) => entry.field.endsWith(".brand"));
  readiness = {
    status: "fail",
    warnings: unique([
      ...readiness.warnings,
      ...publicFieldFindings.map((entry) => `${entry.field} contains marketplace, site chrome, unsupported, or raw spec text and cannot be used as public video input`),
      ...publicMarkdownFindingsList.map((entry) => (
        entry.missing
          ? `${entry.field} is missing and cannot be validated as public video input`
          : `${entry.field} contains marketplace, site chrome, unsupported, or raw spec text and cannot be used as public video input`
      )),
      ...publicDriftFindings
    ]),
    reasonCodes: unique([
      ...readiness.reasonCodes,
      "readiness_invalid",
      ...(publicDriftFindings.length > 0 ? ["readiness_surface_mismatch"] : []),
      ...publicFieldFindings.map((entry) => entry.reasonCode),
      ...publicMarkdownFindingsList.map((entry) => entry.reasonCode)
    ])
  };
  if (titleLeaked || publicDriftFindings.length > 0) title = "Readiness-blocked product";
  if (brandLeaked || publicDriftFindings.length > 0) brand = "Unknown brand";
  copy = "";
  features = [];
}

const readinessStatus = readiness.status;
const reasonCodeText = formatList(readiness.reasonCodes, "none");
const warningLines = readiness.warnings.length > 0 ? readiness.warnings.map((entry) => `- ${entry}`) : ["- none"];
const featureClaims = readinessStatus === "fail"
  ? ["Readiness failed. Do not use copy.md or features.md as verified production input."]
  : features.length > 0
    ? features
    : ["Review manifest data and add only evidence-backed feature claims"];

function evidenceFieldFor(promotedClaim, fallback) {
  const reference = Array.isArray(promotedClaim?.evidenceReferences)
    ? promotedClaim.evidenceReferences.find((entry) => entry && typeof entry.path === "string")
    : undefined;
  return reference?.path || fallback;
}

const claimRows = featureClaims.map((claim, index) => {
  const evidence = pickVisual(screenshots[index], images[index], images[0], screenshots[0]);
  const verified = readinessStatus === "fail" ? "blocked" : readinessStatus === "partial" ? "gated" : "review_required";
  const promotedClaim = promotedClaimFor(claim, index);
  const sourceField = readinessStatus === "fail" ? "presentation-readiness.json" : evidenceFieldFor(promotedClaim, `product.features[${index}]`);
  const reasonCode = readinessStatus === "fail" ? (readiness.reasonCodes[0] || "readiness_invalid") : promotedClaim?.reasonCode || "positive_spec_promoted";
  return `| ${tableCell(claim)} | ${tableCell(evidence)} | ${sourceField} | ${reasonCode} | ${verified} |`;
});

const productionUseLines = {
  pass: [
    "- Production use: allowed after human review of presentation-readiness.json, claims-evidence-map.md, and visual assets.",
    "- The helper is generating normal production briefs because readiness is pass."
  ],
  partial: [
    "- Production use: gated. Resolve warnings and reason codes before final publication.",
    "- The helper is generating draft briefs with constraints, not verified production input."
  ],
  fail: [
    "- Production use: blocked.",
    "- Do not label copy.md, features.md, or product.copy as verified production input."
  ]
}[readinessStatus];

const featureHeading = readinessStatus === "pass" ? "## Production Feature Claims" : "## Gated Feature Candidates";
const copyInput = readinessStatus === "fail"
  ? "Blocked by readiness fail. Do not use captured copy as verified production input."
  : productCopyMatchesEvidence()
    ? copy
    : "(Copy input omitted because product.copy does not match evidence-backed promotedClaims.)";
const hookProductIntro = hasKnownBrand ? `${title} from ${brand}` : title;
const briefTitle = readinessStatus === "fail"
  ? "# Product Video Brief Blocked"
  : readinessStatus === "partial"
    ? "# Gated Video Brief"
    : "# Video Brief";

const videoBrief = [
  briefTitle,
  "",
  `- Product: ${title}`,
  `- Brand: ${brand}`,
  `- Price: ${amount} ${currency}`,
  `- Presentation readiness: ${presentationReadiness.status}`,
  `- Product-video readiness: ${productVideoReadiness.status}`,
  `- Production gate: ${readinessStatus}`,
  `- Reason codes: ${reasonCodeText}`,
  `- Visual capture status: ${hasVisuals ? "visual-ready" : "metadata-first"}`,
  `- Raw evidence: ${rawEvidence.length > 0 ? rawEvidence.join(", ") : "not listed"}`,
  "",
  "## Production Use Rules",
  ...productionUseLines,
  "",
  "## Readiness Warnings",
  ...warningLines,
  "",
  featureHeading,
  ...featureClaims.map((entry) => `- ${entry}`),
  "",
  "## Suggested Hook",
  readinessStatus === "fail"
    ? `- "Do not script ${title} until readiness is fixed."`
    : hasVisuals
      ? `- "${hookProductIntro} should open on its strongest evidence-backed benefit and immediate proof."`
      : `- "${hookProductIntro}: finalize visuals first, then lead with the strongest evidence-backed benefit."`,
  "",
  "## Copy Input",
  copyInput,
  "",
  "## Assets",
  `- Images: ${images.length}`,
  `- Screenshots: ${screenshots.length}`,
  `- Additional visual sourcing required: ${hasVisuals ? "no" : "yes"}`,
  "- Claims evidence map: claims-evidence-map.md"
].join("\n");

const blockedAsset = readinessStatus === "fail" ? "readiness-blocked:fix-presentation-readiness" : undefined;
const shotList = [
  "# Shot List",
  "",
  `Production gate: ${readinessStatus}`,
  "",
  "| Scene | Goal | Asset | Voiceover | Duration |",
  "|---|---|---|---|---:|",
  `| 1 | ${readinessStatus === "fail" ? "Blocked" : "Hook"} | ${blockedAsset || pickVisual(screenshots[0], images[0])} | ${readinessStatus === "fail" ? "Fix readiness before scripting" : "Problem + promise"} | 2s |`,
  `| 2 | ${readinessStatus === "fail" ? "Blocked" : "Feature demo"} | ${blockedAsset || pickVisual(images[0], screenshots[0])} | ${readinessStatus === "fail" ? "No production use" : "Show proof"} | 4s |`,
  `| 3 | ${readinessStatus === "fail" ? "Blocked" : "Outcome + CTA"} | ${blockedAsset || pickVisual(images[1], screenshots[1], images[0], screenshots[0])} | ${readinessStatus === "fail" ? "No CTA until fixed" : "Benefit + CTA"} | 4s |`
].join("\n");

const ugcBrief = [
  "# UGC Brief",
  "",
  `Production gate: ${readinessStatus}`,
  "",
  "## Creator Direction",
  readinessStatus === "fail"
    ? "- Do not hand this pack to creators until presentation readiness is fixed."
    : "- Speak as a real user solving a real problem.",
  readinessStatus === "fail"
    ? "- Use presentation-readiness.json as the diagnostic source."
    : "- Show product in use before listing specs.",
  "- Keep claims aligned with captured assets, manifest data, and presentation-readiness.json.",
  "",
  "## CTA",
  readinessStatus === "fail"
    ? "- CTA blocked until readiness passes or partial warnings are resolved."
    : "- Use one clear CTA tied to the strongest evidence-backed benefit."
].join("\n");

const claimsEvidenceMap = [
  "# Claims Evidence Map",
  "",
  `Production gate: ${readinessStatus}`,
  `Reason codes: ${reasonCodeText}`,
  "",
  "| Claim | Evidence Asset Or Field | Source Field | Readiness Reason Code | Verified |",
  "|---|---|---|---|---|",
  ...claimRows
].join("\n");

fs.writeFileSync(path.join(outdir, "video-brief.md"), videoBrief);
fs.writeFileSync(path.join(outdir, "shot-list.md"), shotList);
fs.writeFileSync(path.join(outdir, "ugc-brief.md"), ugcBrief);
fs.writeFileSync(path.join(outdir, "claims-evidence-map.md"), claimsEvidenceMap);

if (readinessStatus === "fail") {
  process.stderr.write(`Product-video readiness failed. Warning-only brief files written to ${outdir}\n`);
  process.exit(2);
}

process.stdout.write(`Video brief files written to ${outdir}\n`);
NODE
