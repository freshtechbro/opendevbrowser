import type { ResearchRecord } from "../enrichment";
import type {
  ResearchBriefing,
  ResearchBriefingInput
} from "./types";
import {
  DEFAULT_RESEARCH_ARTIFACT_FILES,
  applyAcceptedDestinationOverlapDiscount,
  buildResearchBriefingMetaView,
  findAcceptedDestinationOverlaps,
  normalizeWhitespace
} from "./rules";
import { evaluateEvidenceGate } from "./gate";
import { selectPassages } from "./passages";
import { buildThemes } from "./themes";
import { agreementLines, buildClaims, finalAnswerLines } from "./claims";
import { limitationLines, recommendationLines } from "./guidance";

const claimEligibleRecords = (records: readonly ResearchRecord[]): ResearchRecord[] => (
  records.filter((record) => record.recency.within_timebox)
);

export const buildResearchBriefing = (input: ResearchBriefingInput): ResearchBriefing => {
  const rawMetaView = buildResearchBriefingMetaView(input.meta);
  const acceptedDestinationOverlaps = findAcceptedDestinationOverlaps(rawMetaView.rejectedCandidates, input.records);
  const metaView = applyAcceptedDestinationOverlapDiscount(rawMetaView, acceptedDestinationOverlaps.length);
  const recordsForClaims = claimEligibleRecords(input.records);
  const gate = evaluateEvidenceGate(recordsForClaims, metaView);
  const passages = selectPassages(input.topic, recordsForClaims);
  const themes = buildThemes(input.topic, recordsForClaims, passages);
  const claims = buildClaims({
    records: recordsForClaims,
    themes,
    metaView,
    topic: input.topic,
    gate
  });
  return {
    topic: normalizeWhitespace(input.topic),
    artifactFiles: [...(input.artifactFiles ?? DEFAULT_RESEARCH_ARTIFACT_FILES)],
    acceptedRecords: [...input.records],
    gate,
    metaView,
    passages,
    themes,
    claims,
    finalAnswer: finalAnswerLines(gate, claims),
    agreement: agreementLines(claims),
    limitations: limitationLines(gate, recordsForClaims, metaView, input.records.length - recordsForClaims.length),
    recommendations: recommendationLines(gate, recordsForClaims, metaView),
    acceptedDestinationOverlaps
  };
};
