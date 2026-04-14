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

const readPrimaryConstraint = (data: unknown): Record<string, unknown> | null => {
  const meta = readMeta(data);
  if (!meta) return null;
  const constraint = meta.primaryConstraint ?? meta.primary_constraint;
  return constraint && typeof constraint === "object" && !Array.isArray(constraint)
    ? constraint as Record<string, unknown>
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

const readPrimaryNextStep = (data: unknown): string | null => {
  const constraint = readPrimaryConstraint(data);
  if (!constraint) return null;
  const guidance = constraint.guidance;
  if (!guidance || typeof guidance !== "object" || Array.isArray(guidance)) return null;
  const commands = (guidance as Record<string, unknown>).recommendedNextCommands;
  if (!Array.isArray(commands)) return null;
  const nextStep = commands.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return nextStep?.trim() ?? null;
};

const readFailures = (data: unknown): FailureShape[] => {
  const meta = readMeta(data);
  if (!meta) return [];
  const failures = meta.failures;
  return Array.isArray(failures)
    ? failures.filter((entry): entry is FailureShape => Boolean(entry) && typeof entry === "object")
    : [];
};

const withNextStep = (message: string, nextStep: string | null): string => {
  return nextStep ? `${message} Next step: ${nextStep}` : message;
};

export const buildWorkflowCompletionMessage = (workflowLabel: string, data: unknown): string => {
  const explicitSummary = readPrimarySummary(data);
  if (explicitSummary) {
    return withNextStep(
      `${workflowLabel} completed with provider follow-up required: ${explicitSummary}`,
      readPrimaryNextStep(data)
    );
  }
  const inferred = summarizePrimaryProviderIssue(readFailures(data));
  if (inferred) {
    return withNextStep(
      `${workflowLabel} completed with provider follow-up required: ${inferred.summary}`,
      inferred.guidance?.recommendedNextCommands[0] ?? null
    );
  }
  return `${workflowLabel} completed.`;
};
