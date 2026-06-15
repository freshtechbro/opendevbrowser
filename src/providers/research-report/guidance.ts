import type { ResearchRecord } from "../enrichment";
import type { ResearchBriefing, ResearchEvidenceGate } from "./types";
import {
  MIN_PASS_INDEPENDENT_DOMAINS,
  MIN_USABLE_CONTENT_CHARS,
  compareStableText,
  isActiveChallengeOrchestration,
  recordContentChars,
  uniqueDomains
} from "./rules";

const outOfTimeboxLimitation = (count: number): string[] => {
  if (count <= 0) return [];
  const noun = count === 1 ? "accepted record was" : "accepted records were";
  return [`${count} ${noun} outside the resolved timebox and excluded from claim support.`];
};

const rejectionLimitation = (metaView: ResearchBriefing["metaView"]): string[] => {
  if (metaView.rejectedCandidateCount <= 0) return [];
  const reasons = Object.entries(metaView.sanitizedReasonDistribution)
  .map(([reason, count]) => `${reason}: ${count}`)
  .join(", ");
  const overlapNote = metaView.acceptedDestinationOverlapCount > 0
    ? `; ${metaView.acceptedDestinationOverlapCount} accepted destination overlap(s) were discounted from gate pressure`
    : "";
  return [`Rejected candidates constrain coverage${reasons ? ` (${reasons}${overlapNote})` : overlapNote}.`];
};

const cookieLimitations = (metaView: ResearchBriefing["metaView"]): string[] => (
  metaView.cookieDiagnostics.map((diagnostic) => {
    const blocking = diagnostic.policy === "required" ? "blocking" : "non-blocking";
    return `${diagnostic.message} observed ${diagnostic.count} times under ${diagnostic.policy} policy; ${blocking}.`;
  })
);

const sourceDiversityLimitation = (records: readonly ResearchRecord[]): string[] => (
  uniqueDomains(records).length < MIN_PASS_INDEPENDENT_DOMAINS
    ? ["Source diversity is below the pass threshold."]
    : []
);

const extractionQualityLimitation = (records: readonly ResearchRecord[]): string[] => {
  const weakRecords = records.filter((record) => recordContentChars(record) < MIN_USABLE_CONTENT_CHARS);
  if (weakRecords.length === 0) return [];
  const noun = weakRecords.length === 1 ? "accepted record was" : "accepted records were";
  return [`${weakRecords.length} ${noun} below the ${MIN_USABLE_CONTENT_CHARS}-character usable-content threshold.`];
};

const challengeLimitation = (metaView: ResearchBriefing["metaView"]): string[] => {
  const count = metaView.challengeDiagnostics.length + activeChallengeOrchestrationCount(metaView);
  return count > 0
    ? [`Challenge diagnostics were reported ${count} times; inspect meta.json before relying on browser-recovered evidence.`]
    : [];
};

const activeChallengeOrchestrationCount = (metaView: ResearchBriefing["metaView"]): number => (
  metaView.challengeOrchestration.filter(isActiveChallengeOrchestration).length
);

const antiBotLimitation = (metaView: ResearchBriefing["metaView"]): string[] => (
  metaView.antiBotFailureCount > 0
    ? [`Anti-bot pressure was reported in ${metaView.antiBotFailureCount} of ${metaView.antiBotTotalFailures} provider failures.`]
    : []
);

const numberField = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const transcriptDurabilityLimitation = (metaView: ResearchBriefing["metaView"]): string[] => {
  const attempted = numberField(metaView.transcriptDurability, "attempted");
  const successful = numberField(metaView.transcriptDurability, "successful");
  if (attempted === undefined || successful === undefined) {
    return Object.keys(metaView.transcriptDurability).length > 0
      ? ["Transcript durability metadata was reported; inspect meta.json for transcript-backed evidence limits."]
      : [];
  }
  return attempted > successful
    ? [`Transcript durability is constrained: ${successful} of ${attempted} transcript attempts succeeded.`]
    : [];
};

const alertLimitation = (metaView: ResearchBriefing["metaView"]): string[] => {
  if (metaView.alerts.length === 0) return [];
  const noun = metaView.alerts.length === 1 ? "alert was" : "alerts were";
  return [`${metaView.alerts.length} workflow ${noun} reported; inspect the diagnostics summary and meta.json.`];
};

const failureLimitation = (metaView: ResearchBriefing["metaView"]): string[] => (
  metaView.failureSummaries.length > 0
    ? [`Provider failures were reported: ${metaView.failureSummaries.join("; ")}.`]
    : []
);

export const limitationLines = (
  gate: ResearchEvidenceGate,
  records: readonly ResearchRecord[],
  metaView: ResearchBriefing["metaView"],
  outOfTimeboxRecordCount: number
): string[] => {
  const lines = [
    ...(gate.status !== "pass" ? [gate.summary] : []),
    ...(metaView.primaryConstraintSummary ? [`Primary constraint: ${metaView.primaryConstraintSummary}`] : []),
    ...outOfTimeboxLimitation(outOfTimeboxRecordCount),
    ...sourceDiversityLimitation(records),
    ...extractionQualityLimitation(records),
    ...rejectionLimitation(metaView),
    ...cookieLimitations(metaView),
    ...challengeLimitation(metaView),
    ...antiBotLimitation(metaView),
    ...transcriptDurabilityLimitation(metaView),
    ...alertLimitation(metaView),
    ...failureLimitation(metaView),
    ...metaView.malformedMetadata
  ];
  return lines.length > 0 ? lines : ["No blocking provider limitation was reported in metadata."];
};

const preferredRecord = (records: readonly ResearchRecord[]): ResearchRecord | undefined => (
  [...records].sort((left, right) => {
    const contentDelta = recordContentChars(right) - recordContentChars(left);
    if (contentDelta !== 0) return contentDelta;
    return compareStableText(left.id, right.id);
  })[0]
);

const gateRecommendation = (gate: ResearchEvidenceGate): string[] => (
  gate.status === "fail"
    ? ["Rerun the research with a narrower query, recent time filter, or additional source family before making a final decision."]
    : []
);

const sourceDiversityRecommendation = (records: readonly ResearchRecord[]): string[] => (
  uniqueDomains(records).length < MIN_PASS_INDEPENDENT_DOMAINS
    ? ["Add another independent source family or inspect more destination pages to improve source diversity."]
    : []
);

const cookieRecommendation = (metaView: ResearchBriefing["metaView"]): string[] => (
  metaView.cookieDiagnostics.some((diagnostic) => diagnostic.policy !== "none")
    ? ["Use authorized extension mode or a configured cookie source only when the selected evidence page itself requires access."]
    : []
);

const challengeRecommendation = (metaView: ResearchBriefing["metaView"]): string[] => (
  metaView.challengeDiagnostics.length > 0 || activeChallengeOrchestrationCount(metaView) > 0 || metaView.antiBotFailureCount > 0
    ? ["Use browser-scoped challenge recovery only for selected evidence pages that still require it after public candidate triage."]
    : []
);

const transcriptRecommendation = (metaView: ResearchBriefing["metaView"]): string[] => (
  transcriptDurabilityLimitation(metaView).length > 0
    ? ["Inspect transcript-backed records and rerun with another source family when transcript durability is below the needed confidence level."]
    : []
);

const alertRecommendation = (metaView: ResearchBriefing["metaView"]): string[] => (
  metaView.alerts.length > 0
    ? ["Resolve workflow alerts or treat affected provider evidence as constrained until a clean rerun clears them."]
    : []
);

export const recommendationLines = (
  gate: ResearchEvidenceGate,
  records: readonly ResearchRecord[],
  metaView: ResearchBriefing["metaView"]
): string[] => {
  const preferred = preferredRecord(records);
  const lines = [
    ...gateRecommendation(gate),
    ...sourceDiversityRecommendation(records),
    ...cookieRecommendation(metaView),
    ...challengeRecommendation(metaView),
    ...transcriptRecommendation(metaView),
    ...alertRecommendation(metaView),
    ...(preferred?.url
      ? [`Inspect ${preferred.id} (${preferred.url}) first because it has the richest accepted content.`]
      : [])
  ];
  return lines;
};
