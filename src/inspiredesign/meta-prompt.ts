import type { InspiredesignBriefExpansion } from "./brief-expansion";
import type {
  InspiredesignDesignVectors,
  InspiredesignReferencePatternBoard
} from "./reference-pattern-board";

const formatList = (items: readonly string[]): string => (
  items.length > 0
    ? items.map((item) => `- ${item}`).join("\n")
    : "- No evidence-backed item available."
);

const formatRankedReferences = (
  board: InspiredesignReferencePatternBoard
): string => {
  if (board.references.length === 0) {
    return "- No usable references were ranked. Work from the brief and note missing evidence.";
  }
  return board.references.map((reference) => [
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
  board: InspiredesignReferencePatternBoard
): string => {
  if (board.rejectedReferences.length === 0) {
    return "- No references were rejected from the creative synthesis.";
  }
  return board.rejectedReferences.map((reference) => (
    `- ${reference.url}: ${reference.reason} (fetch=${reference.fetchStatus}, capture=${reference.captureStatus})`
  )).join("\n");
};

export const buildInspiredesignMetaPrompt = (input: {
  brief: string;
  briefExpansion: InspiredesignBriefExpansion;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
}): string => [
  "# InspireDesign Meta Prompt",
  "",
  "Use this prompt to generate a fresh design direction from evidence without copying any reference brand, asset, layout, or proprietary expression.",
  "",
  "## Source Brief",
  input.brief,
  "",
  "## Prompt Format",
  `- Format: ${input.briefExpansion.format.label}`,
  `- Target surface: ${input.referencePatternBoard.targetSurface}`,
  `- Dominant direction: ${input.referencePatternBoard.synthesis.dominantDirection}`,
  "",
  "## Ranked References",
  formatRankedReferences(input.referencePatternBoard),
  "",
  "## Rejected References",
  formatRejectedReferences(input.referencePatternBoard),
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
    "Read visual-evidence.json, screenshot-index.json, ranked-references.json, and evidence.json before implementation.",
    "Confirm screenshot paths exist before making visual claims.",
    "Verify desktop and mobile layouts with real browser screenshots.",
    "Run reduced-motion, keyboard, focus, and contrast checks before shipping.",
    "Keep production code generation outside the harvest output."
  ])
].join("\n");
