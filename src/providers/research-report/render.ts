import type {
  ResearchBriefing,
  ResearchBriefingClaim,
  ResearchBriefingPassage,
  ResearchBriefingTheme
} from "./types";
import {
  boundedInlineText,
  evidenceFocusTerms,
  focusedTextWindow,
  isActiveChallengeOrchestration,
  plainObject,
  recordContentChars,
  recordTitle,
  MIN_USABLE_CONTENT_CHARS
} from "./rules";

const EVIDENCE_EXCERPT_CHARACTERS = 240;

const bulletLines = (lines: readonly string[]): string[] => (
  lines.length === 0 ? ["- None."] : lines.map((line) => `- ${line}`)
);

const renderCriteria = (briefing: ResearchBriefing): string[] => (
  briefing.gate.criteria.map((criterion) => (
    `- ${criterion.label}: observed ${criterion.observed}; threshold ${criterion.threshold}; ${criterion.passed ? "passed" : "not passed"}`
  ))
);

const renderTimebox = (briefing: ResearchBriefing): string => {
  const timebox = briefing.metaView.timebox;
  const mode = typeof timebox.mode === "string" ? timebox.mode : "not_recorded";
  const from = typeof timebox.from === "string" ? timebox.from : "not_recorded";
  const to = typeof timebox.to === "string" ? timebox.to : "not_recorded";
  return `- Timebox: ${mode} from ${from} to ${to}`;
};

const renderClaimSupport = (values: readonly string[]): string => (
  values.length === 0 ? "none" : values.join(", ")
);

const renderClaimUrls = (urls: readonly string[]): string => (
  urls.length === 0 ? "none" : urls.join("; ")
);

const renderClaimMap = (claims: readonly ResearchBriefingClaim[]): string[] => (
  claims.flatMap((claim) => [
    `- ${claim.id} (${claim.label}): ${claim.text}`,
    `  - Status: ${claim.status}`,
    `  - Confidence: ${claim.confidence.label} (${claim.confidence.score})`,
    `  - Supporting records: ${renderClaimSupport(claim.recordIds)}`,
    `  - Source URLs: ${renderClaimUrls(claim.urls)}`,
    `  - Notes: ${claim.notes.join(" ")}`
  ])
);

const renderPassages = (passages: readonly ResearchBriefingPassage[]): string[] => (
  passages.map((passage) => `  - ${passage.recordId}: ${boundedInlineText({
    content: passage.text,
    fallback: "No content excerpt was available.",
    limit: EVIDENCE_EXCERPT_CHARACTERS,
    target: "records.json for full content"
  })}`)
);

const renderTheme = (theme: ResearchBriefingTheme): string[] => [
  `- ${theme.phrase}: ${theme.sourceCount} accepted records across ${theme.domainCount} independent domains.`,
  ...renderPassages(theme.passages)
];

const renderThemes = (themes: readonly ResearchBriefingTheme[]): string[] => (
  themes.length === 0 ? ["- No themes could be promoted from accepted evidence."] : themes.flatMap(renderTheme)
);

const renderConfidence = (claims: readonly ResearchBriefingClaim[]): string[] => (
  claims.map((claim) => {
    const reason = claim.confidence.reasons.length > 0
      ? claim.confidence.reasons.join("; ")
      : "no positive confidence factors were met";
    return `- ${claim.id}: ${claim.confidence.label} (${claim.confidence.score}) because ${reason}.`;
  })
);

const acceptedEvidenceText = (
  briefing: ResearchBriefing,
  recordId: string
): string | undefined => (
  briefing.passages.find((passage) => passage.recordId === recordId)?.text
);

const renderAcceptedSources = (briefing: ResearchBriefing): string[] => {
  if (briefing.acceptedRecords.length === 0) return ["- No accepted records available."];
  const sourceLines = briefing.acceptedRecords.slice(0, 20).flatMap((record) => acceptedSourceLines(briefing, record));
  const omitted = briefing.acceptedRecords.length - 20;
  if (omitted > 0) {
    const noun = omitted === 1 ? "accepted source" : "accepted sources";
    sourceLines.push(`- ${omitted} more ${noun} omitted from this report; see records.json.`);
  }
  return sourceLines;
};

const acceptedSourceLines = (briefing: ResearchBriefing, record: ResearchBriefing["acceptedRecords"][number]): string[] => {
  const title = recordTitle(record);
  const focusedFallback = focusedTextWindow(
    record.content,
    evidenceFocusTerms(briefing.topic, title),
    EVIDENCE_EXCERPT_CHARACTERS
  );
  return [
    `- Record: ${record.id}`,
    `  - Title: ${title}`,
    `  - Source: ${record.source}`,
    `  - Provider: ${record.provider}`,
    `  - URL: ${record.url ?? "URL not provided"}`,
    `  - Record timestamp: ${record.timestamp}`,
    `  - Confidence: ${record.confidence.toFixed(2)}`,
    `  - Within timebox: ${record.recency.within_timebox ? "yes" : "no"}`,
    `  - Content characters: ${recordContentChars(record)}`,
    `  - Evidence: ${acceptedEvidenceLine(briefing, record.id, focusedFallback)}`
  ];
};

const acceptedEvidenceLine = (
  briefing: ResearchBriefing,
  recordId: string,
  focusedFallback: string | undefined
): string => boundedInlineText({
  content: focusedFallback ?? acceptedEvidenceText(briefing, recordId),
  fallback: "No content excerpt was available.",
  limit: EVIDENCE_EXCERPT_CHARACTERS,
  target: "records.json for full content"
});

const renderRejectedCandidates = (briefing: ResearchBriefing): string[] => {
  const reasonLines = Object.entries(briefing.metaView.sanitizedReasonDistribution)
  .map(([reason, count]) => `- ${reason}: ${count}`);
  const deadEndLines = briefing.metaView.deadEndSearchFailureCount > 0
    ? [`- Dead-end search failures: ${briefing.metaView.deadEndSearchFailureCount}`]
    : [];
  const candidateLines = briefing.metaView.rejectedCandidates.slice(0, 10).map((candidate) => (
    `- Rejected candidate: ${candidate.reason} from ${candidate.provider} (${candidate.source}; ${candidate.replacementStatus}; path=${candidate.retrievalPath}): ${candidate.url}`
  ));
  const overlapLines = briefing.acceptedDestinationOverlaps.map((overlap) => (
    `- Search-index candidate rejected as final evidence; destination page accepted after follow-up fetch: ${overlap.rejectedUrl} -> ${overlap.acceptedRecordId} (${overlap.acceptedUrl})`
  ));
  const lines = [...reasonLines, ...candidateLines, ...deadEndLines, ...overlapLines];
  return lines.length > 0 ? lines : ["- No rejected candidate distribution was reported."];
};

const scalarText = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
};

const diagnosticValue = (
  entry: Record<string, unknown>,
  key: string,
  fallback: string
): string => scalarText(entry[key]) ?? fallback;

interface CountedDiagnosticLine {
  line: string;
  count: number;
}

const withDiagnosticCount = (entry: CountedDiagnosticLine): string => (
  entry.count === 1
    ? entry.line
    : entry.line.replace(
      /\.$/,
      ` (observed ${entry.count} times; raw repeated attempts remain in meta.json).`
    )
);

const dedupeDiagnosticLines = (lines: readonly string[]): string[] => {
  const grouped = new Map<string, CountedDiagnosticLine>();
  for (const line of lines) {
    const existing = grouped.get(line);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(line, { line, count: 1 });
    }
  }
  return [...grouped.values()].map(withDiagnosticCount);
};

const challengeDiagnosticLine = (entry: Record<string, unknown>): string => (
  `- Challenge diagnostic: provider=${diagnosticValue(entry, "provider", "unknown_provider")} source=${diagnosticValue(entry, "source", "unknown_source")} reason=${diagnosticValue(entry, "reasonCode", diagnosticValue(entry, "reason", "not_recorded"))}.`
);

const challengeOrchestrationLine = (entry: Record<string, unknown>): string => (
  `- Challenge orchestration: provider=${diagnosticValue(entry, "provider", "unknown_provider")} mode=${diagnosticValue(entry, "mode", "not_recorded")} status=${diagnosticValue(entry, "status", "not_recorded")}.`
);

const renderChallengeDiagnostics = (briefing: ResearchBriefing): string[] => dedupeDiagnosticLines([
  ...briefing.metaView.challengeDiagnostics.map((entry) => challengeDiagnosticLine(plainObject(entry))),
  ...briefing.metaView.challengeOrchestration
  .map(plainObject)
  .filter(isActiveChallengeOrchestration)
  .map(challengeOrchestrationLine)
]);

const renderAntiBotPressure = (briefing: ResearchBriefing): string[] => (
  briefing.metaView.antiBotFailureCount > 0
    ? [`- Anti-bot pressure: ${briefing.metaView.antiBotFailureCount} of ${briefing.metaView.antiBotTotalFailures} provider failures were anti-bot related.`]
    : []
);

const renderTranscriptDurability = (briefing: ResearchBriefing): string[] => {
  const attemptedValue = briefing.metaView.transcriptDurability.attempted;
  const successfulValue = briefing.metaView.transcriptDurability.successful;
  if (
    typeof attemptedValue === "number"
    && Number.isFinite(attemptedValue)
    && typeof successfulValue === "number"
    && Number.isFinite(successfulValue)
  ) {
    if (attemptedValue === 0) return [];
    const attempted = String(attemptedValue);
    const successful = String(successfulValue);
    return [`- Transcript durability: ${successful} of ${attempted} transcript attempts succeeded.`];
  }
  return Object.keys(briefing.metaView.transcriptDurability).length > 0
    ? ["- Transcript durability metadata was reported; see meta.json."]
    : [];
};

const renderAlerts = (briefing: ResearchBriefing): string[] => (
  briefing.metaView.alerts.map((entry) => {
    const alert = plainObject(entry);
    const reason = boundedInlineText({
      content: diagnosticValue(alert, "reason", "not_recorded"),
      fallback: "not_recorded",
      limit: EVIDENCE_EXCERPT_CHARACTERS,
      target: "meta.json"
    });
    return `- Workflow alert: provider=${diagnosticValue(alert, "provider", "unknown_provider")} signal=${diagnosticValue(alert, "signal", "not_recorded")} state=${diagnosticValue(alert, "state", "not_recorded")} reason=${reason}.`;
  })
);

const renderDiagnostics = (briefing: ResearchBriefing): string[] => {
  const cookieLines = briefing.metaView.cookieDiagnostics.map((diagnostic) => (
    `- Cookie diagnostic for ${diagnostic.provider} (${diagnostic.source}) observed ${diagnostic.count} times under ${diagnostic.policy} policy; raw repeated attempts remain in meta.json.`
  ));
  const failureLines = briefing.metaView.failureSummaries.map((failure) => `- ${failure}`);
  const lines = [
    ...cookieLines,
    ...renderChallengeDiagnostics(briefing),
    ...renderAntiBotPressure(briefing),
    ...renderTranscriptDurability(briefing),
    ...renderAlerts(briefing),
    ...failureLines
  ];
  return lines.length > 0 ? lines : ["- No provider diagnostics were reported."];
};

const evidenceGateSection = (briefing: ResearchBriefing): string[] => [
  "## Evidence Gate Status",
  `- Topic: ${briefing.topic}`,
  `- Evidence gate: ${briefing.gate.status}`,
  `- Summary: ${briefing.gate.summary}`,
  renderTimebox(briefing),
  `- Minimum usable content threshold: ${MIN_USABLE_CONTENT_CHARS} characters.`,
  ...renderCriteria(briefing)
];

const renderArtifactFileName = (fileName: string): string => (
  fileName === "bundle-manifest.json"
    ? `- ${fileName} (added by artifact bundle storage)`
    : `- ${fileName}`
);

const evidenceAppendixSection = (briefing: ResearchBriefing): string[] => [
  "## Evidence Appendix",
  "### Report Files",
  ...briefing.artifactFiles.map(renderArtifactFileName),
  "",
  "### Accepted Evidence Passages",
  ...renderAcceptedSources(briefing),
  "",
  "### Rejected Candidate Summary",
  ...renderRejectedCandidates(briefing),
  "",
  "### Diagnostics Summary",
  ...renderDiagnostics(briefing)
];

export const renderResearchBriefingMarkdown = (briefing: ResearchBriefing): string => [
  "# Research Report",
  "",
  ...evidenceGateSection(briefing),
  "",
  "## Final Answer",
  ...bulletLines(briefing.finalAnswer),
  "",
  "## Claim Map",
  ...renderClaimMap(briefing.claims),
  "",
  "## Theme Synthesis",
  ...renderThemes(briefing.themes),
  "",
  "## Source Agreement or Disagreement",
  ...bulletLines(briefing.agreement),
  "",
  "## Confidence by Claim",
  ...renderConfidence(briefing.claims),
  "",
  "## Limitations",
  ...bulletLines(briefing.limitations),
  "",
  "## Recommendations",
  ...bulletLines(briefing.recommendations),
  "",
  ...evidenceAppendixSection(briefing)
].join("\n");
