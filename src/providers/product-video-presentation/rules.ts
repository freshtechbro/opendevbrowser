import type { JsonValue } from "../types";
import type {
  ProductVideoCandidateSource,
  ProductVideoEvidenceReference,
  ProductVideoPresentationInput,
  ProductVideoPresentationReasonCode,
  ProductVideoPromotedClaim,
  ProductVideoRejectedCandidate,
  ProductVideoSpecValue,
  ProductVideoSupportedSpecKey
} from "./types";

export const PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS = 3;
export const PRODUCT_VIDEO_MIN_PARTIAL_PROMOTED_CLAIMS = 1;
export const PRODUCT_VIDEO_MIN_PASS_SPEC_KEY_COUNT = 2;

const MAX_EVIDENCE_EXCERPT_CHARS = 180;
const MIN_CANDIDATE_CHARS = 4;

interface ProductVideoSpecDefinition {
  key: ProductVideoSupportedSpecKey;
  label: string;
  aliases: readonly string[];
  contentLabel: string;
}

export interface ProductVideoSpecEvidence {
  key: ProductVideoSupportedSpecKey;
  label: string;
  value: string;
  evidenceReferences: ProductVideoEvidenceReference[];
}

interface ProductVideoCandidateEvidence {
  text: string;
  source: ProductVideoCandidateSource;
  evidenceReference: ProductVideoEvidenceReference;
}

interface CandidateRejection {
  reasonCode: ProductVideoPresentationReasonCode;
  reason: string;
}

export interface ProductVideoEvidenceCollection {
  specs: ProductVideoSpecEvidence[];
  rejectedCandidates: ProductVideoRejectedCandidate[];
  candidateCount: number;
  marketplaceRejectedCount: number;
  unsupportedRejectedCount: number;
  rawFragmentRejectedCount: number;
}

const TYPE_SPEC_DEFINITION: ProductVideoSpecDefinition = {
  key: "type",
  label: "Type",
  aliases: ["type", "product_type"],
  contentLabel: "Type"
};

const DPI_SPEC_DEFINITION: ProductVideoSpecDefinition = {
  key: "maximum_dpi",
  label: "Maximum DPI",
  aliases: ["maximum_dpi", "maximumdpi", "max_dpi", "dpi"],
  contentLabel: "Maximum DPI"
};

const CONNECTIVITY_SPEC_DEFINITION: ProductVideoSpecDefinition = {
  key: "connectivity",
  label: "Connectivity",
  aliases: ["connectivity", "connection"],
  contentLabel: "Connectivity"
};

const FEATURE_SPEC_DEFINITION: ProductVideoSpecDefinition = {
  key: "features",
  label: "Features",
  aliases: ["features", "feature"],
  contentLabel: "Features"
};

const SPEC_DEFINITIONS: readonly ProductVideoSpecDefinition[] = [
  TYPE_SPEC_DEFINITION,
  DPI_SPEC_DEFINITION,
  CONNECTIVITY_SPEC_DEFINITION,
  FEATURE_SPEC_DEFINITION
];

const CONTENT_BOUNDARY_LABELS = [
  "Type",
  "Maximum DPI",
  "Connectivity",
  "Features",
  "Brand",
  "Model",
  "MPN",
  "Color",
  "Condition",
  "Quantity",
  "Seller",
  "Returns",
  "Shipping",
  "Buy It Now",
  "Item Width",
  "Item Height",
  "Number of Buttons"
] as const;

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
] as const;

const UNSUPPORTED_CLAIM_PATTERNS = [
  /\b(?:best|number one|#1|guaranteed|guarantees)\b/i,
  /\b(?:cure|cures|clinically proven|medical grade)\b/i,
  /\b(?:lifetime warranty|free returns?|risk-free)\b/i
] as const;

const RAW_FRAGMENT_LABEL_THRESHOLD = 2;

const CLAIM_BUILDERS: Record<ProductVideoSupportedSpecKey, (value: string) => string> = {
  type: (value) => `${value} design gives the product a clear presentation category.`,
  maximum_dpi: (value) => `${dpiValue(value)} tracking supports everyday pointer control.`,
  connectivity: (value) => `${value} connectivity supports a cleaner setup.`,
  features: (value) => {
    const phrase = presentationFeaturePhrase(value);
    return `${phrase} ${featureSupportVerb(phrase)} comfort and control.`;
  }
};

export const normalizeProductVideoText = (text: string): string => (
  text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
);

export const isMarketplaceChromeText = (text: string): boolean => {
  const normalized = normalizeProductVideoText(text);
  return MARKETPLACE_CHROME_PATTERNS.some((pattern) => pattern.test(normalized));
};

const isUnsupportedClaimText = (text: string): boolean => {
  const normalized = normalizeProductVideoText(text);
  return UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized));
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isRawSpecFragmentText = (text: string): boolean => {
  const normalized = normalizeProductVideoText(text);
  let labelCount = 0;
  for (const label of CONTENT_BOUNDARY_LABELS) {
    const pattern = new RegExp(`\\b${escapeRegex(label)}\\b\\s*:`, "i");
    if (pattern.test(normalized)) labelCount += 1;
    if (labelCount >= RAW_FRAGMENT_LABEL_THRESHOLD) return true;
  }
  return false;
};

const normalizeProductVideoSpecValue = (value: string): string => (
  normalizeProductVideoText(value).replace(/[.!?]+$/u, "").trim()
);

const featurePhrase = (value: string): string => (
  normalizeProductVideoSpecValue(value).replace(/,\s*([^,]+)$/u, " and $1")
);

const presentationFeaturePhrase = (value: string): string => {
  return featurePhrase(value);
};

const featureSupportVerb = (value: string): string => (
  /\b(?:buttons|controls|features|tools|earbuds|sessions)\b/i.test(value) ? "support" : "supports"
);

const dpiValue = (value: string): string => (/\bdpi\b/i.test(value) ? value : `${value} DPI`);

const normalizeSpecKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const specDefinitionForKey = (key: string): ProductVideoSpecDefinition | undefined => {
  const normalized = normalizeSpecKey(key);
  return SPEC_DEFINITIONS.find((definition) => definition.aliases.includes(normalized));
};

const jsonRecord = (value: JsonValue | undefined): Record<string, JsonValue> | undefined => (
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined
);

const jsonValueToText = (value: JsonValue | undefined): string | undefined => {
  if (typeof value === "string") return normalizeProductVideoText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const jsonValueToStringArray = (value: JsonValue | undefined): string[] => (
  Array.isArray(value)
    ? value.map(jsonValueToText).filter((entry): entry is string => Boolean(entry))
    : []
);

const specValueToText = (value: ProductVideoSpecValue): string => {
  if (Array.isArray(value)) return normalizeProductVideoSpecValue(value.join(", "));
  return normalizeProductVideoSpecValue(String(value));
};

const specValueToTexts = (value: ProductVideoSpecValue): string[] => (
  Array.isArray(value) ? value.map(specValueToText).filter(Boolean) : [specValueToText(value)].filter(Boolean)
);

const jsonValueToSpecTexts = (value: JsonValue | undefined): string[] => {
  const text = jsonValueToText(value);
  if (text) return [text];
  return jsonValueToStringArray(value);
};

const evidenceExcerpt = (value: string): string => normalizeProductVideoText(value).slice(0, MAX_EVIDENCE_EXCERPT_CHARS);

const referenceFor = (args: {
  input: ProductVideoPresentationInput;
  source: ProductVideoCandidateSource;
  path: string;
  label: string;
  excerpt: string;
}): ProductVideoEvidenceReference => ({
  ...(args.input.sourceRecord?.id ? { recordId: args.input.sourceRecord.id } : {}),
  ...(args.input.sourceRecord?.provider ? { provider: args.input.sourceRecord.provider } : {}),
  source: args.source,
  path: args.path,
  label: args.label,
  excerpt: evidenceExcerpt(args.excerpt)
});

const specEvidence = (args: {
  input: ProductVideoPresentationInput;
  definition: ProductVideoSpecDefinition;
  value: string;
  source: ProductVideoCandidateSource;
  path: string;
}): ProductVideoSpecEvidence | undefined => {
  const normalized = normalizeProductVideoSpecValue(args.value);
  if (!normalized || isMarketplaceChromeText(normalized) || isUnsupportedClaimText(normalized) || isRawSpecFragmentText(normalized)) return undefined;
  return {
    key: args.definition.key,
    label: args.definition.label,
    value: normalized,
    evidenceReferences: [referenceFor({
      input: args.input,
      source: args.source,
      path: args.path,
      label: args.definition.label,
      excerpt: normalized
    })]
  };
};

const metadataSpecEvidence = (input: ProductVideoPresentationInput): ProductVideoSpecEvidence[] => {
  const specs = input.metadata?.specs ?? {};
  return Object.entries(specs).flatMap(([key, value]) => {
    const definition = specDefinitionForKey(key);
    if (!definition) return [];
    return specValueToTexts(value).flatMap((entry, index) => {
      const path = Array.isArray(value) ? `metadata.specs.${key}.${index}` : `metadata.specs.${key}`;
      const evidence = specEvidence({ input, definition, value: entry, source: "metadata_feature", path });
      return evidence ? [evidence] : [];
    });
  });
};

const attributeSpecEvidence = (input: ProductVideoPresentationInput): ProductVideoSpecEvidence[] => {
  const attributes = input.sourceRecord?.attributes ?? {};
  const direct = SPEC_DEFINITIONS.flatMap((definition) => specEvidenceFromAttributeAliases(input, attributes, definition));
  const nested = ["specs", "specifications", "details"].flatMap((key) => specEvidenceFromNestedAttributes(input, attributes, key));
  return [...direct, ...nested];
};

const specEvidenceFromAttributeAliases = (
  input: ProductVideoPresentationInput,
  attributes: Record<string, JsonValue>,
  definition: ProductVideoSpecDefinition
): ProductVideoSpecEvidence[] => definition.aliases.flatMap((alias) => {
  const rawValue = attributes[alias];
  return jsonValueToSpecTexts(rawValue).flatMap((value, index) => {
    const path = Array.isArray(rawValue) ? `attributes.${alias}.${index}` : `attributes.${alias}`;
    const evidence = specEvidence({ input, definition, value, source: "source_attribute", path });
    return evidence ? [evidence] : [];
  });
});

const specEvidenceFromNestedAttributes = (
  input: ProductVideoPresentationInput,
  attributes: Record<string, JsonValue>,
  key: string
): ProductVideoSpecEvidence[] => {
  const nested = jsonRecord(attributes[key]);
  if (!nested) return [];
  return Object.entries(nested).flatMap(([nestedKey, value]) => {
    const definition = specDefinitionForKey(nestedKey);
    if (!definition) return [];
    return jsonValueToSpecTexts(value).flatMap((text, index) => {
      const path = Array.isArray(value) ? `attributes.${key}.${nestedKey}.${index}` : `attributes.${key}.${nestedKey}`;
      const evidence = specEvidence({ input, definition, value: text, source: "source_attribute", path });
      return evidence ? [evidence] : [];
    });
  });
};

const contentBoundaryPattern = (): string => CONTENT_BOUNDARY_LABELS.map(escapeRegex).join("|");

const contentSpecPattern = (label: string): RegExp => new RegExp(
  `\\b${escapeRegex(label)}\\b\\s*[:\\-]?\\s*([\\s\\S]*?)(?=\\s+(?:${contentBoundaryPattern()})\\b\\s*[:\\-]?|[.!?]|$)`,
  "gi"
);

const contentSpecEvidence = (input: ProductVideoPresentationInput): ProductVideoSpecEvidence[] => {
  const content = input.sourceRecord?.content;
  if (!content) return [];
  return SPEC_DEFINITIONS.flatMap((definition) => Array.from(content.matchAll(contentSpecPattern(definition.contentLabel))).flatMap((match) => {
    const value = match[1] ? normalizeProductVideoText(match[1]) : "";
    const evidence = specEvidence({ input, definition, value, source: "source_content", path: "content" });
    return evidence ? [evidence] : [];
  }));
};

const metadataFeatureEvidence = (input: ProductVideoPresentationInput): ProductVideoSpecEvidence[] => (
  (input.metadata?.features ?? []).flatMap((feature, index) => {
    const evidence = specEvidence({ input, definition: FEATURE_SPEC_DEFINITION, value: feature, source: "metadata_feature", path: `metadata.features.${index}` });
    return evidence ? [evidence] : [];
  })
);

const attributeFeatureEvidence = (input: ProductVideoPresentationInput): ProductVideoSpecEvidence[] => {
  const features = jsonValueToStringArray(input.sourceRecord?.attributes.features);
  return features.flatMap((feature, index) => {
    const evidence = specEvidence({ input, definition: FEATURE_SPEC_DEFINITION, value: feature, source: "source_attribute", path: `attributes.features.${index}` });
    return evidence ? [evidence] : [];
  });
};

const splitCandidateText = (text: string): string[] => {
  const normalized = normalizeProductVideoText(text);
  if (normalized.length < MIN_CANDIDATE_CHARS) return [];
  return normalized.split(/(?<=[.!?])\s+|\n+/u).map(normalizeProductVideoText).filter(Boolean);
};

const candidateEvidence = (args: {
  input: ProductVideoPresentationInput;
  text: string;
  source: ProductVideoCandidateSource;
  path: string;
  label: string;
}): ProductVideoCandidateEvidence[] => splitCandidateText(args.text).map((entry) => ({
  text: entry,
  source: args.source,
  evidenceReference: referenceFor({
    input: args.input,
    source: args.source,
    path: args.path,
    label: args.label,
    excerpt: entry
  })
}));

const listCandidates = (
  input: ProductVideoPresentationInput,
  values: readonly string[],
  source: ProductVideoCandidateSource,
  pathPrefix: string,
  label: string
): ProductVideoCandidateEvidence[] => values.flatMap((value, index) => candidateEvidence({
  input,
  text: value,
  source,
  path: `${pathPrefix}.${index}`,
  label
}));

const collectCandidates = (input: ProductVideoPresentationInput): ProductVideoCandidateEvidence[] => [
  ...candidateEvidence({ input, text: input.sourceRecord?.content ?? "", source: "source_content", path: "content", label: "Page content" }),
  ...candidateEvidence({ input, text: input.metadata?.description ?? "", source: "metadata_description", path: "metadata.description", label: "Metadata description" }),
  ...listCandidates(input, input.metadata?.features ?? [], "metadata_feature", "metadata.features", "Metadata feature"),
  ...listCandidates(input, input.featureCandidates ?? [], "feature_candidate", "featureCandidates", "Feature candidate"),
  ...listCandidates(input, input.copyCandidates ?? [], "copy_candidate", "copyCandidates", "Copy candidate")
];

const candidateRejection = (candidate: ProductVideoCandidateEvidence): CandidateRejection | undefined => {
  if (isMarketplaceChromeText(candidate.text)) {
    return { reasonCode: "marketplace_chrome_rejected", reason: "marketplace, checkout, shipping, condition, seller, or returns chrome" };
  }
  if (isUnsupportedClaimText(candidate.text)) {
    return { reasonCode: "unsupported_claim_rejected", reason: "candidate contains unsupported superlative, guarantee, medical, warranty, or returns claim" };
  }
  if (isRawSpecFragmentText(candidate.text)) {
    return { reasonCode: "raw_fragment_rejected", reason: "candidate contains multiple product spec labels and appears to be an over-broad page fragment" };
  }
  return undefined;
};

const rejectedCandidate = (
  candidate: ProductVideoCandidateEvidence,
  rejection: CandidateRejection
): ProductVideoRejectedCandidate => ({
  candidate: candidate.text,
  source: candidate.source,
  reasonCode: rejection.reasonCode,
  reason: rejection.reason,
  evidenceReferences: [candidate.evidenceReference]
});

const rejectedSpecValue = (args: {
  input: ProductVideoPresentationInput;
  value: string;
  source: ProductVideoCandidateSource;
  path: string;
  label: string;
}): ProductVideoRejectedCandidate[] => {
  const normalized = normalizeProductVideoText(args.value);
  if (!normalized) return [];
  const candidate: ProductVideoCandidateEvidence = {
    text: normalized,
    source: args.source,
    evidenceReference: referenceFor({
      input: args.input,
      source: args.source,
      path: args.path,
      label: args.label,
      excerpt: normalized
    })
  };
  const rejection = candidateRejection(candidate);
  return rejection ? [rejectedCandidate(candidate, rejection)] : [];
};

const rejectedMetadataSpecValues = (input: ProductVideoPresentationInput): ProductVideoRejectedCandidate[] => {
  const specs = input.metadata?.specs ?? {};
  return Object.entries(specs).flatMap(([key, value]) => {
    const definition = specDefinitionForKey(key);
    if (!definition) return [];
    return specValueToTexts(value).flatMap((entry, index) => {
      const path = Array.isArray(value) ? `metadata.specs.${key}.${index}` : `metadata.specs.${key}`;
      return rejectedSpecValue({ input, value: entry, source: "metadata_feature", path, label: definition.label });
    });
  });
};

const rejectedAttributeSpecValues = (input: ProductVideoPresentationInput): ProductVideoRejectedCandidate[] => {
  const attributes = input.sourceRecord?.attributes ?? {};
  const direct = SPEC_DEFINITIONS.flatMap((definition) => definition.aliases.flatMap((alias) => {
    const rawValue = attributes[alias];
    return jsonValueToSpecTexts(rawValue).flatMap((value, index) => {
      const path = Array.isArray(rawValue) ? `attributes.${alias}.${index}` : `attributes.${alias}`;
      return rejectedSpecValue({ input, value, source: "source_attribute", path, label: definition.label });
    });
  }));
  const nested = ["specs", "specifications", "details"].flatMap((key) => {
    const nestedRecord = jsonRecord(attributes[key]);
    if (!nestedRecord) return [];
    return Object.entries(nestedRecord).flatMap(([nestedKey, rawValue]) => {
      const definition = specDefinitionForKey(nestedKey);
      if (!definition) return [];
      return jsonValueToSpecTexts(rawValue).flatMap((value, index) => {
        const path = Array.isArray(rawValue) ? `attributes.${key}.${nestedKey}.${index}` : `attributes.${key}.${nestedKey}`;
        return rejectedSpecValue({ input, value, source: "source_attribute", path, label: definition.label });
      });
    });
  });
  return [...direct, ...nested];
};

const rejectedSpecValues = (input: ProductVideoPresentationInput): ProductVideoRejectedCandidate[] => [
  ...rejectedMetadataSpecValues(input),
  ...rejectedAttributeSpecValues(input)
];

const dedupeSpecs = (specs: readonly ProductVideoSpecEvidence[]): ProductVideoSpecEvidence[] => {
  const seen = new Set<string>();
  return specs.filter((entry) => {
    const key = `${entry.key}:${entry.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const collectProductVideoEvidence = (input: ProductVideoPresentationInput): ProductVideoEvidenceCollection => {
  const specs = dedupeSpecs([
    ...metadataSpecEvidence(input),
    ...metadataFeatureEvidence(input),
    ...attributeSpecEvidence(input),
    ...attributeFeatureEvidence(input),
    ...contentSpecEvidence(input)
  ]);
  const candidates = collectCandidates(input);
  const rejectedCandidates = candidates.flatMap((candidate) => {
    const rejection = candidateRejection(candidate);
    return rejection ? [rejectedCandidate(candidate, rejection)] : [];
  });
  const specRejectedCandidates = rejectedSpecValues(input);
  const allRejectedCandidates = [...specRejectedCandidates, ...rejectedCandidates];
  return {
    specs,
    rejectedCandidates: allRejectedCandidates,
    candidateCount: candidates.length,
    marketplaceRejectedCount: allRejectedCandidates.filter((entry) => entry.reasonCode === "marketplace_chrome_rejected").length,
    unsupportedRejectedCount: allRejectedCandidates.filter((entry) => entry.reasonCode === "unsupported_claim_rejected").length,
    rawFragmentRejectedCount: allRejectedCandidates.filter((entry) => entry.reasonCode === "raw_fragment_rejected").length
  };
};

export const promoteProductVideoSpec = (spec: ProductVideoSpecEvidence): ProductVideoPromotedClaim => ({
  claim: CLAIM_BUILDERS[spec.key](spec.value),
  specKey: spec.key,
  specLabel: spec.label,
  specValue: spec.value,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: spec.evidenceReferences
});
