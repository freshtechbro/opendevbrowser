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

const readDisplayableNextStep = (value: unknown): string | null => {
  const text = readNonEmptyString(value);
  if (!text) return null;
  return UNRESOLVED_COMMAND_PLACEHOLDER_RE.test(text) ? null : text;
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

const inferPrimaryIssueNextStep = (data: unknown): string | null => {
  return summarizePrimaryProviderIssue(readFailures(data))?.guidance?.recommendedNextCommands[0] ?? null;
};

const readFailures = (data: unknown): FailureShape[] => {
  const meta = readMeta(data);
  if (!meta) return [];
  const failures = meta.failures;
  return Array.isArray(failures)
    ? failures.filter((entry): entry is FailureShape => Boolean(entry) && typeof entry === "object")
    : [];
};

export const readFollowthroughSummary = (data: unknown): string | null => {
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
  const displayableNextStep = readDisplayableNextStep(nextStep);
  return displayableNextStep ? `${message} Next step: ${displayableNextStep}` : message;
};

export const buildProviderFollowupErrorMessage = (message: string): string => {
  const normalized = message.toLowerCase();
  if (normalized.includes("next step:")) return message;
  if (normalized.includes("requires login or an existing session")) {
    return buildNextStepMessage(
      message,
      "Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow."
    );
  }
  if (
    normalized.includes("requires manual browser follow-up")
    || normalized.includes("requires a live browser-rendered page")
  ) {
    return buildNextStepMessage(message, "Retry with browser assistance or a headed browser session.");
  }
  return message;
};

export const readSuggestedNextAction = (data: unknown): string | null => {
  const record = asRecord(data);
  if (!record) return null;
  return readDisplayableNextStep(record.suggestedNextAction)
    ?? readDisplayableNextStep(asRecord(record.sessionInspector)?.suggestedNextAction);
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
      return readDisplayableNextStep(firstStep.reason);
    }
    current = asRecord(current.challengePlan);
  }

  return null;
};

export const readWorkflowGuidanceNextStep = (data: unknown): string | null => (
  readSuggestedNextAction(data) ?? readSuggestedStepCommand(data) ?? readSuggestedStepReason(data)
);

export const buildWorkflowCompletionMessage = (workflowLabel: string, data: unknown): string => {
  const explicitSummary = readPrimarySummary(data);
  if (explicitSummary) {
    return buildNextStepMessage(
      `${workflowLabel} completed with provider follow-up required: ${explicitSummary}`,
      readPrimaryNextStep(data) ?? inferPrimaryIssueNextStep(data)
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
      readWorkflowGuidanceNextStep(data)
    );
  }
  return `${workflowLabel} completed.`;
};
