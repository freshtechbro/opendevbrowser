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

const UNRESOLVED_COMMAND_PLACEHOLDER_RE = /<[^>\n]+>/;

const readRunnableStepCommand = (step: Record<string, unknown>): string | null => {
  const command = readNonEmptyString(step.command);
  if (!command) return null;
  return UNRESOLVED_COMMAND_PLACEHOLDER_RE.test(command) ? null : command;
};

const readMeta = (data: unknown): Record<string, unknown> | null => {
  return asRecord(asRecord(data)?.meta);
};

const readPrimaryConstraint = (data: unknown): Record<string, unknown> | null => {
  const meta = readMeta(data);
  if (!meta) return null;
  return asRecord(meta.primaryConstraint);
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

const readFollowthroughSummary = (data: unknown): string | null => {
  const record = asRecord(data);
  return readNonEmptyString(record?.followthroughSummary)
    ?? readNonEmptyString(readMeta(data)?.followthroughSummary);
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

export const readSuggestedStepCommand = (data: unknown): string | null => {
  let current = asRecord(data);

  while (current) {
    const command = readSuggestedSteps(current)
      .map(readRunnableStepCommand)
      .find((step): step is string => Boolean(step));
    if (command) {
      return command;
    }
    current = asRecord(current.challengePlan);
  }

  return null;
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
  const followthroughSummary = readFollowthroughSummary(data);
  if (followthroughSummary) {
    return buildNextStepMessage(
      `${workflowLabel} completed. ${followthroughSummary}`,
      readSuggestedNextAction(data) ?? readSuggestedStepCommand(data) ?? readSuggestedStepReason(data)
    );
  }
  return `${workflowLabel} completed.`;
};
