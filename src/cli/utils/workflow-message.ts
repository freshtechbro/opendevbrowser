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

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const readNonEmptyString = (value: unknown): string | null => (
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
);

const readMeta = (data: unknown): Record<string, unknown> | null => {
  return asRecord(asRecord(data)?.meta);
};

const readPrimaryConstraint = (data: unknown): Record<string, unknown> | null => {
  const meta = readMeta(data);
  if (!meta) return null;
  const constraint = meta.primaryConstraint ?? meta.primary_constraint;
  return asRecord(constraint);
};

const readPrimarySummary = (data: unknown): string | null => {
  const meta = readMeta(data);
  return readNonEmptyString(meta?.primaryConstraintSummary);
};

const readPrimaryNextStep = (data: unknown): string | null => {
  const constraint = readPrimaryConstraint(data);
  if (!constraint) return null;
  const guidance = asRecord(constraint.guidance);
  if (!guidance) return null;
  const commands = guidance.recommendedNextCommands;
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

const readSuggestedSteps = (data: unknown): readonly Record<string, unknown>[] => {
  const steps = asRecord(data)?.suggestedSteps;
  return Array.isArray(steps)
    ? steps.flatMap((step) => {
      const record = asRecord(step);
      return record ? [record] : [];
    })
    : [];
};

export const buildNextStepMessage = (message: string, nextStep: string | null): string => {
  return nextStep ? `${message} Next step: ${nextStep}` : message;
};

export const readSuggestedNextAction = (data: unknown): string | null => {
  const record = asRecord(data);
  if (!record) return null;
  return readNonEmptyString(record.suggestedNextAction)
    ?? readNonEmptyString(asRecord(record.sessionInspector)?.suggestedNextAction);
};

export const readSuggestedStepReason = (data: unknown): string | null => {
  let current = asRecord(data);

  while (current) {
    const [firstStep] = readSuggestedSteps(current);
    if (firstStep) {
      return readNonEmptyString(firstStep.reason);
    }
    current = asRecord(current.challengePlan);
  }

  return null;
};

export const buildWorkflowCompletionMessage = (workflowLabel: string, data: unknown): string => {
  const explicitSummary = readPrimarySummary(data);
  if (explicitSummary) {
    return buildNextStepMessage(
      `${workflowLabel} completed with provider follow-up required: ${explicitSummary}`,
      readPrimaryNextStep(data)
    );
  }
  const inferred = summarizePrimaryProviderIssue(readFailures(data));
  if (inferred) {
    return buildNextStepMessage(
      `${workflowLabel} completed with provider follow-up required: ${inferred.summary}`,
      inferred.guidance?.recommendedNextCommands[0] ?? null
    );
  }
  return `${workflowLabel} completed.`;
};
