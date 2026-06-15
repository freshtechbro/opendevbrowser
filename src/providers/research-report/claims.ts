import type { ResearchRecord } from "../enrichment";
import type {
  ResearchBriefing,
  ResearchBriefingClaim,
  ResearchBriefingTheme,
  ResearchClaimConfidence,
  ResearchClaimStatus,
  ResearchEvidenceGate
} from "./types";
import {
  MAX_PASS_REJECTION_PRESSURE,
  MIN_PASS_INDEPENDENT_DOMAINS,
  MIN_USABLE_CONTENT_CHARS,
  compareStableText,
  focusedTextWindow,
  normalizeWhitespace,
  recordContentChars,
  rejectionPressure,
  tokenize,
  topicTokens,
  uniqueDomains
} from "./rules";
import { hasDisagreementCue } from "./rules";
import { isLowSignalEvidenceText, phraseIsActionable } from "./passages";
import { phraseIsTopicOnlyEcho } from "./themes";

const MAX_FINAL_ACCEPTED_CLAIMS = 3;
const MAX_FINAL_TENTATIVE_CLAIMS = 3;
const CLAIM_EVIDENCE_SUMMARY_CHARACTERS = 180;
const CONFIDENCE_STRENGTH_WEIGHT = 100;
const RECORD_STRENGTH_WEIGHT = 10;

interface ConfidenceFactor {
  applies: boolean;
  delta: number;
  reason: string;
}

const average = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const confidenceLabel = (score: number): ResearchClaimConfidence["label"] => {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
};

const confidenceFactors = (args: {
  supportingRecords: readonly ResearchRecord[];
  domains: readonly string[];
  avgContentChars: number;
  avgConfidence: number;
  allInsideTimebox: boolean;
  theme: ResearchBriefingTheme;
  records: readonly ResearchRecord[];
  metaView: ResearchBriefing["metaView"];
}): ConfidenceFactor[] => [
  ...supportCoverageFactors(args),
  ...qualityFactors(args),
  ...riskFactors(args)
];

const supportCoverageFactors = (args: {
  supportingRecords: readonly ResearchRecord[];
  domains: readonly string[];
}): ConfidenceFactor[] => [
  {
    applies: args.supportingRecords.length >= 2,
    delta: 2,
    reason: "at least two supporting records"
  },
  {
    applies: args.domains.length >= 2,
    delta: 2,
    reason: "at least two independent domains"
  }
];

const qualityFactors = (args: {
  avgContentChars: number;
  avgConfidence: number;
  allInsideTimebox: boolean;
  supportingRecords: readonly ResearchRecord[];
}): ConfidenceFactor[] => [
  {
    applies: args.avgContentChars >= MIN_USABLE_CONTENT_CHARS,
    delta: 1,
    reason: `average accepted content >= ${MIN_USABLE_CONTENT_CHARS} characters`
  },
  {
    applies: args.avgConfidence >= 0.7,
    delta: 1,
    reason: "average source confidence >= 0.70"
  },
  {
    applies: args.allInsideTimebox && args.supportingRecords.length > 0,
    delta: 1,
    reason: "supporting records are inside the resolved timebox"
  }
];

const riskFactors = (args: {
  theme: ResearchBriefingTheme;
  records: readonly ResearchRecord[];
  metaView: ResearchBriefing["metaView"];
}): ConfidenceFactor[] => [
  {
    applies: args.theme.disagreementSignals.length > 0,
    delta: -1,
    reason: "explicit disagreement cues detected"
  },
  {
    applies: args.metaView.failureSummaries.length > 0,
    delta: -1,
    reason: "provider failures were reported"
  },
  {
    applies: rejectionPressure(args.records.length, args.metaView.effectiveRejectedCandidateCount) > MAX_PASS_REJECTION_PRESSURE,
    delta: -1,
    reason: "overall evidence gate is constrained by rejected-candidate pressure"
  }
];

const scoreConfidence = (args: {
  records: readonly ResearchRecord[];
  theme: ResearchBriefingTheme;
  metaView: ResearchBriefing["metaView"];
}): ResearchClaimConfidence => {
  const supportingRecords = args.records.filter((record) => args.theme.recordIds.includes(record.id));
  const factors = confidenceFactors({
    supportingRecords,
    domains: uniqueDomains(supportingRecords),
    avgContentChars: average(supportingRecords.map(recordContentChars)),
    avgConfidence: average(supportingRecords.map((record) => record.confidence)),
    allInsideTimebox: supportingRecords.every((record) => record.recency.within_timebox),
    theme: args.theme,
    records: args.records,
    metaView: args.metaView
  }).filter((factor) => factor.applies);
  const score = factors.reduce((sum, factor) => sum + factor.delta, 0);
  return { label: confidenceLabel(score), score, reasons: factors.map((factor) => factor.reason) };
};

const claimEvidenceSummary = (theme: ResearchBriefingTheme): string => {
  const passage = theme.passages[0];
  if (!passage) return "no representative passage selected";
  const focusTerms = [theme.phrase, ...tokenize(theme.phrase)];
  const focused = focusedTextWindow(passage.text, focusTerms, CLAIM_EVIDENCE_SUMMARY_CHARACTERS);
  const normalized = normalizeWhitespace(focused);
  if (normalized.length <= CLAIM_EVIDENCE_SUMMARY_CHARACTERS) return normalized;
  return `${normalized.slice(0, CLAIM_EVIDENCE_SUMMARY_CHARACTERS)}...`;
};

const emptyEvidenceClaim = (): ResearchBriefingClaim => ({
  id: "claim-1",
  label: "evidence sufficiency",
  text: "Evidence is insufficient because no accepted records passed the research evidence gate.",
  status: "excluded",
  confidence: { label: "low", score: 0, reasons: ["No accepted records were available."] },
  recordIds: [],
  urls: [],
  passages: [],
  notes: ["Rejected or failed candidates cannot support final claims."]
});

const noThemeClaim = (records: readonly ResearchRecord[]): ResearchBriefingClaim => ({
  id: "claim-1",
  label: "usable passage support",
  text: "Accepted records did not contain enough usable passage text to support a deterministic claim.",
  status: "excluded",
  confidence: { label: "low", score: 0, reasons: ["No selected passage supported a theme."] },
  recordIds: records.map((record) => record.id),
  urls: records.flatMap((record) => record.url ? [record.url] : []),
  passages: [],
  notes: ["Accepted records remain available in the evidence appendix and records.json."]
});

const failedGateClaim = (
  records: readonly ResearchRecord[],
  gate: ResearchEvidenceGate
): ResearchBriefingClaim => ({
  id: "claim-1",
  label: "evidence gate",
  text: `Evidence gate failed, so accepted records cannot support deterministic claims. ${gate.summary}`,
  status: "excluded",
  confidence: { label: "low", score: 0, reasons: ["overall evidence gate failed"] },
  recordIds: [],
  urls: [],
  passages: [],
  notes: [
    `${records.length} accepted record(s) remain available in the evidence appendix, but none support this excluded claim.`
  ]
});

const claimStatusForTheme = (theme: ResearchBriefingTheme, topic: string): ResearchClaimStatus => {
  const genericTopicEcho = phraseIsTopicOnlyEcho(theme.phrase, new Set(topicTokens(topic)))
    && !phraseIsActionable(theme.phrase);
  return theme.domainCount >= MIN_PASS_INDEPENDENT_DOMAINS && !genericTopicEcho
    ? "accepted"
    : "tentative";
};

const claimFromTheme = (args: {
  theme: ResearchBriefingTheme;
  index: number;
  records: readonly ResearchRecord[];
  metaView: ResearchBriefing["metaView"];
  topic: string;
}): ResearchBriefingClaim => {
  const status = claimStatusForTheme(args.theme, args.topic);
  const evidenceSummary = claimEvidenceSummary(args.theme);
  const text = status === "accepted"
    ? `Accepted evidence supports ${args.theme.phrase} across ${args.theme.domainCount} independent sources, anchored by: ${evidenceSummary}`
    : `${args.theme.phrase} appears in accepted evidence but lacks enough independent-source support; representative passage: ${evidenceSummary}`;
  return {
    id: `claim-${args.index + 1}`,
    label: args.theme.phrase,
    text,
    status,
    confidence: scoreConfidence({
      records: args.records,
      theme: args.theme,
      metaView: args.metaView
    }),
    recordIds: args.theme.recordIds,
    urls: args.theme.urls,
    passages: args.theme.passages,
    notes: args.theme.disagreementSignals.length > 0
      ? [`Disagreement cues: ${[...new Set(args.theme.disagreementSignals)].join(", ")}`]
      : ["No direct disagreement cue detected for this claim."]
  };
};

export const buildClaims = (args: {
  records: readonly ResearchRecord[];
  themes: readonly ResearchBriefingTheme[];
  metaView: ResearchBriefing["metaView"];
  topic: string;
  gate: ResearchEvidenceGate;
}): ResearchBriefingClaim[] => {
  if (args.records.length === 0) return [emptyEvidenceClaim()];
  if (args.gate.status === "fail") return [failedGateClaim(args.records, args.gate)];
  if (args.themes.length === 0) return [noThemeClaim(args.records)];
  return args.themes.map((theme, index) => claimFromTheme({
    theme,
    index,
    records: args.records,
    metaView: args.metaView,
    topic: args.topic
  }));
};

const claimHasActionableEvidence = (claim: ResearchBriefingClaim): boolean => (
  claim.passages.some((passage) => (
    !isLowSignalEvidenceText(passage.analysisText) && phraseIsActionable(passage.analysisText)
  ))
);

const claimStrengthScore = (claim: ResearchBriefingClaim): number => {
  const passageScore = Math.max(0, ...claim.passages.map((passage) => passage.score));
  return claim.confidence.score * CONFIDENCE_STRENGTH_WEIGHT
    + claim.recordIds.length * RECORD_STRENGTH_WEIGHT
    + passageScore;
};

const strongestTentativeClaims = (claims: readonly ResearchBriefingClaim[]): ResearchBriefingClaim[] => (
  [...claims].sort((left, right) => {
    const scoreDelta = claimStrengthScore(right) - claimStrengthScore(left);
    if (scoreDelta !== 0) return scoreDelta;
    return compareStableText(left.id, right.id);
  })
);

const finalClaimSupport = (claim: ResearchBriefingClaim): string => (
  claim.recordIds.length > 0 ? claim.recordIds.join(", ") : "none"
);

const finalClaimReference = (claim: ResearchBriefingClaim): string => `${claim.label} (${claim.id})`;

const finalClaimLine = (claim: ResearchBriefingClaim): string => `${claim.label} - ${claim.id}: ${claim.text}`;

const acceptedFinalAnswerLines = (
  gate: ResearchEvidenceGate,
  accepted: readonly ResearchBriefingClaim[]
): string[] => {
  const selected = accepted.slice(0, MAX_FINAL_ACCEPTED_CLAIMS);
  const prefix = gate.status === "partial" ? "Under a partial evidence gate, accepted evidence" : "The accepted evidence";
  const noun = selected.length === 1 ? "finding" : "findings";
  return [
    `${prefix} supports ${selected.length} decision-ready ${noun}: ${selected.map(finalClaimReference).join("; ")}.`,
    ...selected.map(finalClaimLine),
    ...(accepted.length > selected.length
      ? [`${accepted.length - selected.length} additional accepted claims remain in the claim map.`]
      : [])
  ];
};

const tentativeFinalAnswerLines = (
  gate: ResearchEvidenceGate,
  tentative: readonly ResearchBriefingClaim[],
  includeConstrainedTentative: boolean
): string[] => {
  const actionableTentative = tentative.filter((claim) => claim.confidence.label !== "low" && claimHasActionableEvidence(claim));
  const selected = actionableTentative.slice(0, MAX_FINAL_TENTATIVE_CLAIMS);
  const constrainedSelected = includeConstrainedTentative && selected.length === 0
    ? strongestTentativeClaims(tentative).slice(0, MAX_FINAL_TENTATIVE_CLAIMS)
    : [];
  const constrainedIntro = gate.status === "partial"
    ? "Under a partial evidence gate, accepted records provide bounded signals from these low-confidence tentative claims"
    : "Accepted records provide bounded low-confidence signals from these tentative claims";
  return [
    ...(selected.length > 0
      ? [
        `Tentative evidence also points to these claims: ${selected.map(finalClaimReference).join("; ")}.`,
        ...selected.map(finalClaimLine)
      ]
      : []),
    ...(constrainedSelected.length > 0
      ? [
        `${constrainedIntro}: ${constrainedSelected.map(finalClaimReference).join("; ")}.`,
        ...constrainedSelected.map((claim) => `${finalClaimLine(claim)} Supporting records: ${finalClaimSupport(claim)}.`),
        "These tentative claims remain constrained and should be checked against the claim map and records.json before publication."
      ]
      : []),
    ...(actionableTentative.length > selected.length
      ? [`${actionableTentative.length - selected.length} additional medium-confidence tentative claims remain in the claim map.`]
      : []),
    ...(tentative.length > actionableTentative.length + constrainedSelected.length
      ? [`${tentative.length - actionableTentative.length - constrainedSelected.length} additional low-confidence tentative claims remain in the claim map as constrained signals.`]
      : []),
    ...(constrainedSelected.length > 0
      ? ["Selected low-confidence tentative claims are included only as bounded signals, not confirmed findings."]
      : [])
  ];
};

export const finalAnswerLines = (
  gate: ResearchEvidenceGate,
  claims: readonly ResearchBriefingClaim[]
): string[] => {
  if (gate.status === "fail") {
    return [
      "Evidence is insufficient to provide a supported final answer.",
      gate.summary
    ];
  }
  const accepted = claims.filter((claim) => claim.status === "accepted");
  const tentative = claims.filter((claim) => claim.status === "tentative");
  const includeConstrainedTentative = accepted.length === 0;
  const acceptedClaimTentativeSummary = accepted.length > 0 && tentative.length > 0
    ? [`${tentative.length} tentative claims remain in the claim map as constrained signals.`]
    : [];
  const lines = [
    ...(accepted.length > 0 ? acceptedFinalAnswerLines(gate, accepted) : []),
    ...acceptedClaimTentativeSummary,
    ...(accepted.length === 0 ? tentativeFinalAnswerLines(gate, tentative, includeConstrainedTentative) : [])
  ];
  return lines.length > 0 ? lines : ["Evidence is usable but did not produce a multi-source accepted claim."];
};

export const agreementLines = (claims: readonly ResearchBriefingClaim[]): string[] => {
  const accepted = claims.filter((claim) => claim.status === "accepted");
  const disagreementClaims = claims.filter((claim) => (
    claim.passages.some((passage) => hasDisagreementCue(passage.analysisText))
    || claim.notes.some((note) => note.startsWith("Disagreement cues:"))
  ));
  return [
    accepted.length > 0
      ? `Source overlap detected for ${accepted.map((claim) => claim.id).join(", ")}.`
      : "No multi-source agreement detected in accepted claims.",
    disagreementClaims.length > 0
      ? `Direct disagreement cues detected for ${disagreementClaims.map((claim) => claim.id).join(", ")}.`
      : "No direct disagreement detected in accepted sources."
  ];
};
