import {
  INSPIREDESIGN_MEDIA_ANALYSIS_MAX_GUIDANCE_ENTRIES,
  type InspiredesignMediaAnalysisReference,
  type InspiredesignMediaDesignGuidance,
  type InspiredesignMediaFacts,
  type InspiredesignMediaKind
} from "./types";

const HIGH_CONFIDENCE_THRESHOLD = 0.78;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.52;
const DARK_DOMINANT_THRESHOLD = 0.55;
const BRIGHT_DOMINANT_THRESHOLD = 0.45;

export const buildInspiredesignMediaDesignGuidance = (input: {
  facts: InspiredesignMediaFacts;
  kind: InspiredesignMediaKind;
  limitations: readonly string[];
  confidence: number;
}): InspiredesignMediaDesignGuidance => {
  const layoutRecipe = describeLayoutRecipe(input.facts);
  const typographyPosture = input.facts.typographyStructure?.posture ?? "Typography structure unavailable without decoded frames.";
  return {
    visualStrengths: limitGuidanceEntries(buildVisualStrengths(input.facts)),
    visualRisks: limitGuidanceEntries(buildVisualRisks(input.limitations, input.facts)),
    layoutRecipe,
    contentHierarchy: limitGuidanceEntries(buildContentHierarchy(input.facts)),
    componentFamilies: limitGuidanceEntries(buildComponentFamilies(input.facts, input.kind)),
    motionPosture: describeMotionPosture(input.facts, input.kind),
    tokenNotes: limitGuidanceEntries(buildTokenNotes(input.facts)),
    patternsToBorrow: limitGuidanceEntries(buildBorrowPatterns(input.facts, layoutRecipe)),
    patternsToReject: limitGuidanceEntries(buildRejectPatterns(input.facts)),
    typographyPosture,
    imageryPosture: describeImageryPosture(input.facts),
    confidence: input.confidence
  };
};

export const buildEmptyInspiredesignMediaDesignGuidance = (limitations: readonly string[]): InspiredesignMediaDesignGuidance => ({
  visualStrengths: [],
  visualRisks: limitGuidanceEntries([...limitations]),
  layoutRecipe: "Media analysis produced no layout recipe.",
  contentHierarchy: [],
  componentFamilies: [],
  motionPosture: "Motion posture unavailable without decoded frames.",
  tokenNotes: [],
  patternsToBorrow: [],
  patternsToReject: ["Do not invent media-derived palette, layout, typography, or motion claims without decoded evidence."],
  typographyPosture: "Typography structure unavailable without decoded frames.",
  imageryPosture: "Imagery posture unavailable without decoded frames.",
  confidence: 0
});

export const summarizeInspiredesignMediaReferenceForBoard = (
  reference: InspiredesignMediaAnalysisReference
): string[] => limitGuidanceEntries([
  ...reference.designGuidance.visualStrengths,
  reference.designGuidance.layoutRecipe,
  reference.designGuidance.motionPosture,
  reference.designGuidance.typographyPosture
]);

const buildVisualStrengths = (facts: InspiredesignMediaFacts): string[] => {
  const strengths: string[] = [];
  if (facts.tone) {
    strengths.push(`${facts.tone.contrastPosture} contrast with ${Math.round(facts.tone.darkCoverage * 100)} percent dark coverage and ${facts.tone.densityPosture} edge density.`);
  }
  if (facts.palette?.length) {
    strengths.push(`Quantized palette led by ${facts.palette.slice(0, 3).map((swatch) => swatch.hex).join(", ")}.`);
  }
  if (facts.layout) {
    strengths.push(`Layout heuristic reads as ${facts.layout.composition}.`);
  }
  if (facts.typographyStructure?.regions.length) {
    strengths.push(`OCR-free typography structure detected ${facts.typographyStructure.regions.length} role candidate regions.`);
  }
  if (facts.motion && facts.motion.sampledFrameCount > 1) {
    strengths.push(`Sampled saved-media motion cadence is ${facts.motion.cadence} with average frame delta ${facts.motion.averageFrameDelta}.`);
    const signature = facts.motion.motionSignature;
    if (signature && signature.confidence >= MEDIUM_CONFIDENCE_THRESHOLD && signature.dominantChangedRegions.length > 0) {
      const regions = signature.dominantChangedRegions.map((region) => `row ${region.row + 1}, column ${region.column + 1}`).join("; ");
      strengths.push(`Saved-media motion signature is ${signature.motionFamily}; dominant sampled change regions: ${regions}.`);
    }
  }
  return strengths;
};

const buildVisualRisks = (limitations: readonly string[], facts: InspiredesignMediaFacts): string[] => {
  const risks = [...limitations];
  if (!facts.typographyStructure?.readableTextAvailable) {
    risks.push("Readable exact text extraction was not performed, so exact copy strings are unavailable.");
  }
  if (!facts.palette) {
    risks.push("Palette claims are unavailable without decoded RGB frames.");
  }
  if (!facts.motion) {
    risks.push("Real motion claims are unavailable without sampled frame deltas.");
  }
  return risks;
};

const buildContentHierarchy = (facts: InspiredesignMediaFacts): string[] => {
  const roles = facts.typographyStructure?.regions.map((region) => region.role) ?? [];
  return [...new Set(roles)].map((role) => `${role} from OCR-free text-region geometry`);
};

const buildComponentFamilies = (facts: InspiredesignMediaFacts, kind: InspiredesignMediaKind): string[] => {
  const families = new Set<string>();
  facts.layout?.zones.forEach((zone) => {
    if (zone.role === "hero_copy" || zone.role === "hero_media") {
      families.add("hero");
    }
    if (zone.role === "cta_cluster") {
      families.add("CTA cluster");
    }
    if (zone.role === "portfolio_grid" || zone.role === "caption_row") {
      families.add("portfolio grid or card set");
    }
  });
  if (kind === "gif" || kind === "video") {
    families.add("motion loop");
  }
  return [...families];
};

const buildTokenNotes = (facts: InspiredesignMediaFacts): string[] => {
  const notes = facts.palette?.map((swatch) => `${swatch.hex} as ${swatch.roleHint} at ${Math.round(swatch.coverage * 100)} percent coverage`) ?? [];
  if (facts.tone) {
    notes.push(`${facts.tone.contrastPosture} contrast posture, mean luminance ${facts.tone.meanLuminance}.`);
  }
  return notes;
};

const buildBorrowPatterns = (facts: InspiredesignMediaFacts, layoutRecipe: string): string[] => {
  const patterns = [layoutRecipe];
  if (facts.tone?.darkCoverage && facts.tone.darkCoverage >= DARK_DOMINANT_THRESHOLD) {
    patterns.push("dark-dominant cinematic canvas with sparse bright controls");
  }
  if (facts.tone?.brightCoverage && facts.tone.brightCoverage >= BRIGHT_DOMINANT_THRESHOLD) {
    patterns.push("bright editorial surface with measured contrast anchors");
  }
  if (facts.typographyStructure?.regions.length) {
    patterns.push("OCR-free typography hierarchy using measured role candidates");
  }
  if (facts.motion?.posture === "dynamic_motion") {
    patterns.push("dynamic sampled saved-media motion rhythm with reduced-motion adaptation");
  }
  return patterns;
};

const buildRejectPatterns = (facts: InspiredesignMediaFacts): string[] => {
  const patterns = ["generic route-default direction that ignores measured media facts"];
  if (facts.tone?.darkCoverage && facts.tone.darkCoverage >= DARK_DOMINANT_THRESHOLD) {
    patterns.push("bright laboratory palette that contradicts dark media evidence");
  }
  if (!facts.typographyStructure?.readableTextAvailable) {
    patterns.push("claiming exact headlines, nav labels, CTA copy, or font families from v1 media analysis");
  }
  return patterns;
};

const describeLayoutRecipe = (facts: InspiredesignMediaFacts): string => {
  if (!facts.layout) {
    return "Layout recipe unavailable without decoded frames.";
  }
  return `${facts.layout.composition} with ${Math.round(facts.layout.whitespaceCoverage * 100)} percent low-activity canvas.`;
};

const describeMotionPosture = (facts: InspiredesignMediaFacts, kind: InspiredesignMediaKind): string => {
  if (facts.motion && facts.motion.sampledFrameCount > 1) {
    const signature = facts.motion.motionSignature;
    if (signature) {
      const sceneCue = signature.sceneSummary && signature.sceneSummary.eventCount > 0
        ? ` FFmpeg scene-score detected ${signature.sceneSummary.eventCount} sampled cut-like event(s), strongest score ${signature.sceneSummary.strongestScore}.`
        : "";
      const reducedMotion = signature.motionFamily === "dynamic_motion" || signature.motionFamily === "cut_or_scene_change" || signature.motionFamily === "fade_or_exposure_shift"
        ? " Provide reduced-motion alternatives that preserve hierarchy without sampled video pacing."
        : "";
      return `${facts.motion.posture} saved-media motion sampled from ${facts.motion.sampledFrameCount} frames at ${facts.motion.cadence} cadence; signature family ${signature.motionFamily}.${sceneCue}${reducedMotion}`;
    }
    return `${facts.motion.posture} saved-media motion sampled from ${facts.motion.sampledFrameCount} frames at ${facts.motion.cadence} cadence.`;
  }
  if (kind === "image" || kind === "video_poster") {
    return "Static source only, use still-image adaptation such as reveal, fade, or hover exposure shift.";
  }
  return "Motion posture unavailable because frames were not decoded.";
};

const describeImageryPosture = (facts: InspiredesignMediaFacts): string => {
  const tone = facts.tone;
  if (!tone) {
    return "Imagery posture unavailable without pixel statistics.";
  }
  if (tone.darkCoverage >= DARK_DOMINANT_THRESHOLD) {
    return `dark-dominant, ${tone.contrastPosture} contrast, ${tone.densityPosture} detail posture`;
  }
  if (tone.brightCoverage >= BRIGHT_DOMINANT_THRESHOLD) {
    return `bright-dominant, ${tone.contrastPosture} contrast, ${tone.densityPosture} detail posture`;
  }
  return `balanced luminance, ${tone.contrastPosture} contrast, ${tone.densityPosture} detail posture`;
};

const limitGuidanceEntries = (entries: readonly string[]): string[] =>
  entries.filter((entry) => entry.trim().length > 0).slice(0, INSPIREDESIGN_MEDIA_ANALYSIS_MAX_GUIDANCE_ENTRIES);

export const confidenceLabel = (confidence: number): "high" | "medium" | "low" => {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return "high";
  }
  return confidence >= MEDIUM_CONFIDENCE_THRESHOLD ? "medium" : "low";
};
