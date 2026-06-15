import type { ResearchRecord } from "../enrichment";
import type { ResearchBriefing, ResearchEvidenceGate } from "./types";
import {
  MAX_PARTIAL_REJECTION_PRESSURE,
  MAX_PASS_REJECTION_PRESSURE,
  MIN_PARTIAL_ACCEPTED_RECORDS,
  MIN_PASS_ACCEPTED_RECORDS,
  MIN_PASS_INDEPENDENT_DOMAINS,
  MIN_USABLE_CONTENT_CHARS,
  isActiveChallengeOrchestration,
  isRequiredCookieDiagnostic,
  recordContentChars,
  rejectionPressure,
  uniqueDomains
} from "./rules";

const formatRatio = (value: number): string => value.toFixed(2);

interface GateFacts {
  acceptedRecordCount: number;
  domainCount: number;
  maxContentChars: number;
  pressure: number;
  acceptedDestinationOverlapCount: number;
  blockingDiagnostics: number;
  requiredCookieDiagnostics: number;
  activeChallengeOrchestrations: number;
  workflowAlerts: number;
  antiBotFailures: number;
  antiBotTotalFailures: number;
}

const requiredCookieDiagnosticCount = (metaView: ResearchBriefing["metaView"]): number => (
  metaView.cookieDiagnostics
  .filter(isRequiredCookieDiagnostic)
  .reduce((sum, diagnostic) => sum + diagnostic.count, 0)
);

const activeChallengeOrchestrationCount = (metaView: ResearchBriefing["metaView"]): number => (
  metaView.challengeOrchestration.filter(isActiveChallengeOrchestration).length
);

const gateSummary = (
  status: ResearchEvidenceGate["status"],
  acceptedRecordCount: number,
  domainCount: number,
  pressure: number,
  blockingDiagnostics: number
): string => {
  if (status === "fail") {
    return "Evidence is insufficient for a supported answer; accepted evidence is absent or below the usable-content threshold.";
  }
  if (status === "pass") {
    return `Evidence passed with ${acceptedRecordCount} accepted records across ${domainCount} independent domains and rejection pressure ${formatRatio(pressure)}.`;
  }
  return `Evidence is usable but constrained: ${acceptedRecordCount} accepted records, ${domainCount} independent domains, rejection pressure ${formatRatio(pressure)}, and ${blockingDiagnostics} blocking diagnostics.`;
};

const statusForGate = (args: {
  acceptedRecordCount: number;
  maxContentChars: number;
  pass: boolean;
}): ResearchEvidenceGate["status"] => {
  if (
    args.acceptedRecordCount < MIN_PARTIAL_ACCEPTED_RECORDS
    || args.maxContentChars < MIN_USABLE_CONTENT_CHARS
  ) {
    return "fail";
  }
  return args.pass ? "pass" : "partial";
};

const gateFacts = (
  records: readonly ResearchRecord[],
  metaView: ResearchBriefing["metaView"]
): GateFacts => {
  const requiredCookieDiagnostics = requiredCookieDiagnosticCount(metaView);
  const activeChallengeOrchestrations = activeChallengeOrchestrationCount(metaView);
  return {
    acceptedRecordCount: records.length,
    domainCount: uniqueDomains(records).length,
    maxContentChars: Math.max(0, ...records.map(recordContentChars)),
    pressure: rejectionPressure(records.length, metaView.effectiveRejectedCandidateCount),
    acceptedDestinationOverlapCount: metaView.acceptedDestinationOverlapCount,
    blockingDiagnostics: metaView.failureSummaries.length
      + metaView.challengeDiagnostics.length
      + requiredCookieDiagnostics
      + activeChallengeOrchestrations
      + metaView.alerts.length,
    requiredCookieDiagnostics,
    activeChallengeOrchestrations,
    workflowAlerts: metaView.alerts.length,
    antiBotFailures: metaView.antiBotFailureCount,
    antiBotTotalFailures: metaView.antiBotTotalFailures
  };
};

const gatePasses = (facts: GateFacts): boolean => (
  facts.acceptedRecordCount >= MIN_PASS_ACCEPTED_RECORDS
  && facts.domainCount >= MIN_PASS_INDEPENDENT_DOMAINS
  && facts.maxContentChars >= MIN_USABLE_CONTENT_CHARS
  && facts.pressure <= MAX_PASS_REJECTION_PRESSURE
  && facts.blockingDiagnostics === 0
  && facts.antiBotFailures === 0
);

const gateCriteria = (facts: GateFacts): ResearchEvidenceGate["criteria"] => [
  {
    label: "Accepted records",
    observed: String(facts.acceptedRecordCount),
    threshold: `partial >= ${MIN_PARTIAL_ACCEPTED_RECORDS}; pass >= ${MIN_PASS_ACCEPTED_RECORDS}`,
    passed: facts.acceptedRecordCount >= MIN_PARTIAL_ACCEPTED_RECORDS
  },
  {
    label: "Independent accepted domains",
    observed: String(facts.domainCount),
    threshold: `pass >= ${MIN_PASS_INDEPENDENT_DOMAINS}`,
    passed: facts.domainCount >= MIN_PASS_INDEPENDENT_DOMAINS
  },
  {
    label: "Usable content characters",
    observed: String(facts.maxContentChars),
    threshold: `>= ${MIN_USABLE_CONTENT_CHARS} in at least one accepted record`,
    passed: facts.maxContentChars >= MIN_USABLE_CONTENT_CHARS
  },
  {
    label: "Rejected-candidate pressure for pass",
    observed: formatRatio(facts.pressure),
    threshold: `<= ${MAX_PASS_REJECTION_PRESSURE}${facts.acceptedDestinationOverlapCount > 0 ? ` after discounting ${facts.acceptedDestinationOverlapCount} accepted destination overlap(s)` : ""}`,
    passed: facts.pressure <= MAX_PASS_REJECTION_PRESSURE
  },
  {
    label: "Rejected-candidate pressure for partial",
    observed: formatRatio(facts.pressure),
    threshold: `warning <= ${MAX_PARTIAL_REJECTION_PRESSURE}; higher pressure keeps usable accepted evidence partial instead of fail${facts.acceptedDestinationOverlapCount > 0 ? ` after discounting ${facts.acceptedDestinationOverlapCount} accepted destination overlap(s)` : ""}`,
    passed: facts.pressure <= MAX_PARTIAL_REJECTION_PRESSURE
  },
  {
    label: "Blocking diagnostics",
    observed: String(facts.blockingDiagnostics),
    threshold: "0 provider failures, required cookie diagnostics, challenge diagnostics, active challenge orchestrations, or workflow alerts for pass",
    passed: facts.blockingDiagnostics === 0
  },
  {
    label: "Required cookie diagnostics",
    observed: String(facts.requiredCookieDiagnostics),
    threshold: "0 required-cookie diagnostics for pass",
    passed: facts.requiredCookieDiagnostics === 0
  },
  {
    label: "Active challenge orchestrations",
    observed: String(facts.activeChallengeOrchestrations),
    threshold: "0 active challenge orchestrations for pass",
    passed: facts.activeChallengeOrchestrations === 0
  },
  {
    label: "Workflow alerts",
    observed: String(facts.workflowAlerts),
    threshold: "0 workflow alerts for pass",
    passed: facts.workflowAlerts === 0
  },
  {
    label: "Anti-bot failures",
    observed: `${facts.antiBotFailures} of ${facts.antiBotTotalFailures}`,
    threshold: "0 anti-bot failures for pass",
    passed: facts.antiBotFailures === 0
  }
];

export const evaluateEvidenceGate = (
  records: readonly ResearchRecord[],
  metaView: ResearchBriefing["metaView"]
): ResearchEvidenceGate => {
  const facts = gateFacts(records, metaView);
  const status = statusForGate({
    acceptedRecordCount: facts.acceptedRecordCount,
    maxContentChars: facts.maxContentChars,
    pass: gatePasses(facts)
  });
  return {
    status,
    summary: gateSummary(
      status,
      facts.acceptedRecordCount,
      facts.domainCount,
      facts.pressure,
      facts.blockingDiagnostics
    ),
    criteria: gateCriteria(facts)
  };
};
