import { summarizePrimaryProviderIssue } from "../../providers/constraint";

type FailureShape = {
  provider?: string;
  error?: {
    reasonCode?: unknown;
    code?: unknown;
    message?: unknown;
    details?: Record<string, unknown>;
  };
};

const readMeta = (data: unknown): Record<string, unknown> | null => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const meta = (data as Record<string, unknown>).meta;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : null;
};

const readPrimarySummary = (data: unknown): string | null => {
  const meta = readMeta(data);
  if (!meta) return null;
  const summary = meta.primaryConstraintSummary;
  return typeof summary === "string" && summary.trim().length > 0
    ? summary.trim()
    : null;
};

const readFailures = (data: unknown): FailureShape[] => {
  const meta = readMeta(data);
  if (!meta) return [];
  const failures = meta.failures;
  return Array.isArray(failures)
    ? failures.filter((entry): entry is FailureShape => Boolean(entry) && typeof entry === "object")
    : [];
};

export const buildWorkflowCompletionMessage = (workflowLabel: string, data: unknown): string => {
  const explicitSummary = readPrimarySummary(data);
  if (explicitSummary) {
    return `${workflowLabel} completed with provider follow-up required: ${explicitSummary}`;
  }
  const inferred = summarizePrimaryProviderIssue(readFailures(data));
  if (inferred) {
    return `${workflowLabel} completed with provider follow-up required: ${inferred.summary}`;
  }
  return `${workflowLabel} completed.`;
};
