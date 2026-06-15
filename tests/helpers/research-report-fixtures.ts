import { renderResearch } from "../../src/providers/renderer";
import type { NormalizedRecord } from "../../src/providers/types";

export const makeResearchRecord = (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  id: "evidence-1",
  source: "web",
  provider: "web/default",
  url: "https://example.com/research-report-quality",
  title: "Research report quality",
  content: [
    "Deterministic research reports need claim maps that connect accepted evidence to conclusions.",
    "Decision-ready evidence briefings should show source agreement, confidence, limitations, and recommendations.",
    "Browser automation research output quality improves when accepted passages are cited directly."
  ].join(" "),
  timestamp: "2026-06-10T00:00:00.000Z",
  confidence: 0.92,
  attributes: {
    retrievalPath: "web:fetch:url",
    extractionQuality: {
      hasContent: true,
      contentChars: 3200
    }
  },
  ...overrides
});

export const researchReportMarkdown = (args: Parameters<typeof renderResearch>[0]): string => {
  const report = renderResearch(args).files.find((file) => file.path === "report.md");
  return typeof report?.content === "string" ? report.content : "";
};
