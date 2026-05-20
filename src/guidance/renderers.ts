import type { JsonValue } from "../providers/types";
import type { NextStepGuidance } from "./types";

export type GuidanceCompatibilityStep = {
  reason: string;
  command?: string;
};

export type GuidanceWorkflowCompatibility = {
  followthroughSummary: string;
  suggestedNextAction: string;
  suggestedSteps: GuidanceCompatibilityStep[];
};

export type GuidanceProviderCompatibility = {
  reason: string;
  recommendedNextCommands: string[];
  nextStepGuidance: Record<string, JsonValue>;
};

const toJsonValue = (value: NextStepGuidance): Record<string, JsonValue> => {
  return structuredClone(value) as Record<string, JsonValue>;
};

export const renderWorkflowGuidance = (guidance: NextStepGuidance): Record<string, JsonValue> => {
  return toJsonValue(guidance);
};

export const renderCliGuidance = (guidance: NextStepGuidance): string => {
  const commands = guidance.commands.map((entry) => `Run: ${entry.command}`);
  const checks = guidance.validationChecks.map((entry) => `Check: ${entry.assertion ?? entry.description}`);
  return [guidance.primaryAction.summary, ...commands, ...checks].join("\n");
};

export const renderWorkflowCompatibility = (
  guidance: NextStepGuidance,
  fallbackSummary?: string
): GuidanceWorkflowCompatibility => {
  const commandSteps = guidance.commands.map((entry) => ({
    reason: entry.label,
    command: entry.command
  }));
  const artifactSteps = guidance.artifactInputs.map((entry) => ({
    reason: `${entry.required ? "Required" : "Optional"}: ${entry.path}. ${entry.purpose}`
  }));
  const validationSteps = guidance.validationChecks.map((entry) => ({
    reason: entry.assertion ? `${entry.description} Assertion: ${entry.assertion}` : entry.description,
    ...(entry.command ? { command: entry.command } : {})
  }));
  return {
    followthroughSummary: fallbackSummary ?? guidance.primaryAction.summary,
    suggestedNextAction: guidance.primaryAction.summary,
    suggestedSteps: [...commandSteps, ...artifactSteps, ...validationSteps]
  };
};

export const renderProviderConstraintCompatibility = (
  guidance: NextStepGuidance
): GuidanceProviderCompatibility => ({
  reason: guidance.primaryAction.summary,
  recommendedNextCommands: guidance.commands.map((entry) => entry.command),
  nextStepGuidance: renderWorkflowGuidance(guidance)
});

export const renderDaemonReadinessText = (guidance: NextStepGuidance): string => {
  const firstCheck = guidance.validationChecks[0]?.assertion ?? guidance.validationChecks[0]?.description;
  if (firstCheck) {
    return `${guidance.primaryAction.summary} Validate with ${firstCheck}.`;
  }
  return guidance.primaryAction.summary;
};
