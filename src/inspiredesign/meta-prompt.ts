import type { InspiredesignBriefExpansion } from "./brief-expansion";
import {
  isInspiredesignDesignReference,
  type InspiredesignDesignVectors,
  type InspiredesignReferencePatternBoard
} from "./reference-pattern-board";

type RankedReference = InspiredesignReferencePatternBoard["references"][number];

const formatList = (items: readonly string[]): string => (
  items.length > 0
    ? items.map((item) => `- ${item}`).join("\n")
    : "- No evidence-backed item available."
);

const formatRankedReferences = (
  references: readonly RankedReference[]
): string => {
  if (references.length === 0) {
    return "- No ready references were ranked. Work from the brief and note missing evidence.";
  }
  return references.map((reference) => [
    `### Rank ${reference.rank}: ${reference.name}`,
    `- URL: ${reference.url}`,
    `- Score: ${reference.score}`,
    `- Confidence: ${reference.confidence.toFixed(2)}`,
    `- Selection reason: ${reference.selectionReason}`,
    `- Borrow: ${reference.patternsToBorrow.join("; ")}`,
    `- Reject: ${reference.patternsToReject.join("; ")}`,
    `- Visual strengths: ${reference.visualStrengths.join("; ")}`,
    `- Visual risks: ${reference.visualRisks.join("; ")}`
  ].join("\n")).join("\n\n");
};

const formatRejectedReferences = (
  board: InspiredesignReferencePatternBoard,
  notReadyReferences: readonly RankedReference[]
): string => {
  const lines = [
    ...(board.rejectedReferences.length > 0
      ? [`- ${board.rejectedReferences.length} reference(s) were rejected as diagnostic-only or unavailable.`]
      : []),
    ...(notReadyReferences.length > 0
      ? [`- ${notReadyReferences.length} ranked reference(s) were not ready for creative synthesis due to score, confidence, or brief-intent mismatch.`]
      : [])
  ];
  return lines.length > 0 ? lines.join("\n") : "- No references were rejected from the creative synthesis.";
};

export const buildInspiredesignMetaPrompt = (input: {
  brief: string;
  briefExpansion: InspiredesignBriefExpansion;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
}): string => {
  const designReferences = input.referencePatternBoard.references.filter(isInspiredesignDesignReference);
  const notReadyReferences = input.referencePatternBoard.references.filter(
    (reference) => !isInspiredesignDesignReference(reference)
  );
  return [
    "# InspireDesign Meta Prompt",
    "",
    "Use this prompt to generate a fresh design direction from evidence without copying any reference brand, asset, layout, or proprietary expression.",
    "",
    "## Source Brief",
    input.brief,
    "",
    "## Prompt Format",
    `- Format: ${input.briefExpansion.format.label}`,
    `- Target surface: ${input.designVectors.surfaceIntent}`,
    `- Dominant direction: ${input.designVectors.directionLabel}`,
    "",
    "## Ranked References",
    formatRankedReferences(designReferences),
    "",
    "## Rejected References",
    formatRejectedReferences(input.referencePatternBoard, notReadyReferences),
    "",
    "## Borrow Guidance",
    formatList(input.designVectors.patternsToBorrow),
    "",
    "## Reject Guidance",
    formatList([
      ...input.designVectors.patternsToReject,
      "Do not copy logos, screenshots, protected brand assets, page structure, copy, or trade dress from references."
    ]),
    "",
    "## Motion Posture",
    formatList([
      ...input.designVectors.motionPosture,
      ...input.designVectors.interactionMoments,
      ...input.designVectors.advancedMotionAdvisory
    ]),
    "",
    "## Accessibility Constraints",
    formatList([
      "Keyboard navigation must reach every interactive element.",
      "Focus states must be visible in every theme and viewport.",
      "Respect prefers-reduced-motion with a static hierarchy-preserving alternative.",
      "Validate contrast for text, controls, overlays, and disabled states."
    ]),
    "",
    "## Validation Gates",
    formatList([
      "Read visual-evidence.json, screenshot-index.json, motion-evidence.json, pin-media-evidence.json, pin-media-index.json, media-analysis.json, ranked-references.json, and evidence.json before implementation.",
      "Confirm screenshot, replay, or pin-media paths exist before making visual or motion claims.",
      "Cite media-analysis.json and the saved media path for every media-derived palette, layout, typography, imagery, or motion claim.",
      "Treat Pinterest pin-media as product-ready only when pin-media-index.json proves persisted first-party media bytes for a canonical pin. media-analysis.json is a design-fact surface, not a readiness gate. Remote media URLs alone are not proof.",
      "Verify desktop and mobile layouts with real browser screenshots.",
      "Run reduced-motion, keyboard, focus, and contrast checks before shipping.",
      "Keep production code generation outside the harvest output."
    ])
  ].join("\n");
};
