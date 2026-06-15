import type { ResearchRecord } from "../enrichment";
import type { ProviderSource } from "../types";

export type ResearchEvidenceGateStatus = "pass" | "partial" | "fail";
export type ResearchClaimStatus = "accepted" | "tentative" | "excluded";
export type ResearchConfidenceLabel = "high" | "medium" | "low";

export interface ResearchBriefingInput {
  topic: string;
  records: ResearchRecord[];
  meta: Record<string, unknown>;
  artifactFiles?: readonly string[];
}

export interface ResearchBriefingCriterion {
  label: string;
  observed: string;
  threshold: string;
  passed: boolean;
}

export interface ResearchEvidenceGate {
  status: ResearchEvidenceGateStatus;
  summary: string;
  criteria: ResearchBriefingCriterion[];
}

export interface ResearchBriefingPassage {
  recordId: string;
  title: string;
  url: string;
  source: ProviderSource;
  provider: string;
  text: string;
  analysisText: string;
  score: number;
}

export interface ResearchBriefingTheme {
  phrase: string;
  recordIds: string[];
  urls: string[];
  domainCount: number;
  sourceCount: number;
  passages: ResearchBriefingPassage[];
  disagreementSignals: string[];
}

export interface ResearchClaimConfidence {
  label: ResearchConfidenceLabel;
  score: number;
  reasons: string[];
}

export interface ResearchBriefingClaim {
  id: string;
  label: string;
  text: string;
  status: ResearchClaimStatus;
  confidence: ResearchClaimConfidence;
  recordIds: string[];
  urls: string[];
  passages: ResearchBriefingPassage[];
  notes: string[];
}

export interface ResearchCookieDiagnosticView {
  provider: string;
  source: string;
  policy: string;
  sourceRef: string;
  sessionEvidence: string;
  message: string;
}

export interface ResearchCookieDiagnosticSummary extends ResearchCookieDiagnosticView {
  count: number;
}

export interface ResearchRejectedCandidateView {
  provider: string;
  source: string;
  reason: string;
  replacementStatus: string;
  retrievalPath: string;
  url: string;
}

export interface ResearchAcceptedDestinationOverlap {
  rejectedUrl: string;
  acceptedRecordId: string;
  acceptedUrl: string;
}

export interface ResearchBriefingMetaView {
  primaryConstraintSummary?: string;
  timebox: Record<string, unknown>;
  sourceSelection: string;
  resolvedSources: string[];
  totalRecords: number;
  withinTimebox: number;
  finalRecords: number;
  failedSources: string[];
  failureSummaries: string[];
  rejectedCandidateCount: number;
  effectiveRejectedCandidateCount: number;
  acceptedDestinationOverlapCount: number;
  sanitizedReasonDistribution: Record<string, number>;
  cookieDiagnostics: ResearchCookieDiagnosticSummary[];
  challengeDiagnostics: Array<Record<string, unknown>>;
  challengeOrchestration: Array<Record<string, unknown>>;
  antiBotPressure: Record<string, unknown>;
  antiBotFailureCount: number;
  antiBotTotalFailures: number;
  transcriptDurability: Record<string, unknown>;
  alerts: Array<Record<string, unknown>>;
  rejectedCandidates: ResearchRejectedCandidateView[];
  deadEndSearchFailureCount: number;
  malformedMetadata: string[];
}

export interface ResearchBriefing {
  topic: string;
  artifactFiles: string[];
  acceptedRecords: ResearchRecord[];
  gate: ResearchEvidenceGate;
  metaView: ResearchBriefingMetaView;
  passages: ResearchBriefingPassage[];
  themes: ResearchBriefingTheme[];
  claims: ResearchBriefingClaim[];
  finalAnswer: string[];
  agreement: string[];
  limitations: string[];
  recommendations: string[];
  acceptedDestinationOverlaps: ResearchAcceptedDestinationOverlap[];
}
