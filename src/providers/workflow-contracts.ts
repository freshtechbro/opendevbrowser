import type { JsonValue } from "./types";

export type WorkflowKind = "research" | "shopping" | "product_video";
export type WorkflowStage = "compile" | "execute" | "postprocess" | "resume";

export type WorkflowStepBudget = {
  maxAttempts?: number;
  maxResults?: number;
  timeoutMs?: number;
};

export type WorkflowStepPolicy = {
  sources?: string[];
  providers?: string[];
};

export type WorkflowPlanStep = {
  id: string;
  kind: string;
  budget?: WorkflowStepBudget;
  policy?: WorkflowStepPolicy;
  input?: Record<string, JsonValue>;
};

export type WorkflowPlan = {
  kind: WorkflowKind;
  steps: WorkflowPlanStep[];
  meta?: Record<string, JsonValue>;
};

export type WorkflowCheckpoint = {
  stage: WorkflowStage;
  stepId?: string;
  stepIndex?: number;
  state?: Record<string, JsonValue>;
  updatedAt?: string;
};

export type WorkflowTraceEntry = {
  at: string;
  stage: WorkflowStage;
  event: string;
  details?: Record<string, JsonValue>;
};

export type WorkflowResumeEnvelope = {
  kind: WorkflowKind;
  input: Record<string, JsonValue>;
  checkpoint?: WorkflowCheckpoint | null;
  trace?: WorkflowTraceEntry[];
};

const isJsonRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isWorkflowStage = (value: JsonValue | undefined): value is WorkflowStage => (
  value === "compile" || value === "execute" || value === "postprocess" || value === "resume"
);

const isWorkflowCheckpoint = (value: JsonValue | undefined): value is WorkflowCheckpoint => (
  isJsonRecord(value)
  && isWorkflowStage(value.stage)
  && (value.stepId === undefined || typeof value.stepId === "string")
  && (value.stepIndex === undefined || typeof value.stepIndex === "number")
  && (value.state === undefined || isJsonRecord(value.state))
  && (value.updatedAt === undefined || typeof value.updatedAt === "string")
);

const isWorkflowTraceEntry = (value: JsonValue | undefined): value is WorkflowTraceEntry => (
  isJsonRecord(value)
  && typeof value.at === "string"
  && isWorkflowStage(value.stage)
  && typeof value.event === "string"
  && (value.details === undefined || isJsonRecord(value.details))
);

export const isWorkflowKind = (value: JsonValue | undefined): value is WorkflowKind => (
  value === "research" || value === "shopping" || value === "product_video"
);

export const buildWorkflowResumeEnvelope = (
  kind: WorkflowKind,
  input: JsonValue,
  options: {
    checkpoint?: WorkflowCheckpoint | null;
    trace?: WorkflowTraceEntry[];
  } = {}
): WorkflowResumeEnvelope => ({
  kind,
  input: input as Record<string, JsonValue>,
  ...(options.checkpoint !== undefined ? { checkpoint: options.checkpoint } : {}),
  ...(options.trace !== undefined ? { trace: options.trace } : {})
});

export const isWorkflowResumeEnvelope = (value: JsonValue | undefined): value is WorkflowResumeEnvelope => (
  isJsonRecord(value)
  && isWorkflowKind(value.kind)
  && isJsonRecord(value.input)
  && (value.checkpoint === undefined || value.checkpoint === null || isWorkflowCheckpoint(value.checkpoint))
  && (
    value.trace === undefined
    || (
      Array.isArray(value.trace)
      && value.trace.every((entry) => isWorkflowTraceEntry(entry as JsonValue))
    )
  )
);

export const isWorkflowResumePayload = (
  value: JsonValue | undefined
): value is { workflow: WorkflowResumeEnvelope } => (
  isJsonRecord(value) && isWorkflowResumeEnvelope(value.workflow)
);
