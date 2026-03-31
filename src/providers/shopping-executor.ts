import { isLikelyOfferRecord } from "./shopping-postprocess";
import {
  buildWorkflowResumeEnvelope,
  type WorkflowCheckpoint,
  type WorkflowResumeEnvelope,
  type WorkflowTraceEntry
} from "./workflow-contracts";
import {
  createShoppingSearchStepId,
  deriveShoppingFetchSteps,
  serializeShoppingCheckpointState,
  type CompiledShoppingExecutionPlan,
  type ShoppingFetchWorkflowStep,
  type ShoppingWorkflowCheckpointState,
  type ShoppingWorkflowExecutionStep,
  type ShoppingSearchWorkflowStep
} from "./shopping-compiler";
import type { JsonValue, ProviderAggregateResult, ProviderRunOptions } from "./types";
import type { ShoppingWorkflowRun } from "./shopping-workflow";
import type { ProviderExecutor } from "./workflows";

export type ShoppingWorkflowExecutionResult = {
  runs: ShoppingWorkflowRun[];
  checkpoint: WorkflowCheckpoint;
  trace: WorkflowTraceEntry[];
};

export type ShoppingWorkflowProviderAccumulator = Record<string, ProviderAggregateResult>;

export type ExecuteShoppingWorkflowPlanOptions = {
  trace?: WorkflowTraceEntry[];
  observeResult?: (result: ProviderAggregateResult) => void;
  buildStepOptions: (
    step: ShoppingWorkflowExecutionStep,
    envelope: WorkflowResumeEnvelope
  ) => ProviderRunOptions;
};

const appendTrace = (
  trace: WorkflowTraceEntry[],
  stage: WorkflowTraceEntry["stage"],
  event: string,
  details?: Record<string, JsonValue>
): WorkflowTraceEntry[] => [
  ...trace,
  {
    at: new Date().toISOString(),
    stage,
    event,
    ...(details ? { details } : {})
  }
];

const getCheckpointedResult = (
  checkpointState: ShoppingWorkflowCheckpointState,
  stepId: string
): ProviderAggregateResult => {
  const result = checkpointState.step_results_by_id[stepId];
  if (!result) {
    throw new Error(`Shopping workflow checkpoint is missing result for completed step ${stepId}.`);
  }
  return result;
};

const buildCheckpoint = (
  checkpointState: ShoppingWorkflowCheckpointState,
  step: ShoppingWorkflowExecutionStep,
  stepIndex: number
): WorkflowCheckpoint => ({
  stage: "execute",
  stepId: step.id,
  stepIndex,
  state: serializeShoppingCheckpointState(checkpointState),
  updatedAt: new Date().toISOString()
});

const markStepCompleted = (
  checkpointState: ShoppingWorkflowCheckpointState,
  stepId: string,
  result: ProviderAggregateResult
): ShoppingWorkflowCheckpointState => ({
  completed_step_ids: checkpointState.completed_step_ids.includes(stepId)
    ? checkpointState.completed_step_ids
    : [...checkpointState.completed_step_ids, stepId],
  step_results_by_id: {
    ...checkpointState.step_results_by_id,
    [stepId]: result
  }
});

const mergeProviderResult = (
  base: ProviderAggregateResult,
  fetchResult: ProviderAggregateResult
): ProviderAggregateResult => {
  const fetchedOfferRecords = fetchResult.records.filter((record) => isLikelyOfferRecord(record));
  if (fetchedOfferRecords.length === 0 || fetchResult.failures.length > 0) {
    return base;
  }

  return {
    ...base,
    ok: base.ok && fetchResult.ok,
    partial: base.partial || fetchResult.partial,
    records: [...base.records, ...fetchedOfferRecords],
    providerOrder: [...new Set([...base.providerOrder, ...fetchResult.providerOrder])],
    metrics: {
      attempted: base.metrics.attempted + fetchResult.metrics.attempted,
      succeeded: base.metrics.succeeded + fetchResult.metrics.succeeded,
      failed: base.metrics.failed + fetchResult.metrics.failed,
      retries: base.metrics.retries + fetchResult.metrics.retries,
      latencyMs: base.metrics.latencyMs + fetchResult.metrics.latencyMs
    }
  };
};

const buildProviderRuns = (
  plan: CompiledShoppingExecutionPlan,
  checkpointState: ShoppingWorkflowCheckpointState,
  fetchSteps: ShoppingWorkflowExecutionStep[]
): ShoppingWorkflowRun[] => {
  const fetchStepByProviderId = new Map(fetchSteps.map((step) => [
    step.input.providerId,
    step
  ]));

  return plan.compiled.effectiveProviderIds.flatMap((providerId) => {
    const searchStepId = createShoppingSearchStepId(providerId);
    const searchResult = checkpointState.step_results_by_id[searchStepId];
    if (!searchResult) {
      return [];
    }

    const fetchStep = fetchStepByProviderId.get(providerId);
    const fetchResult = fetchStep ? checkpointState.step_results_by_id[fetchStep.id] : undefined;
    const result = fetchResult ? mergeProviderResult(searchResult, fetchResult) : searchResult;

    return [{
      providerId,
      result
    }];
  });
};

const executeSearchStep = async (
  runtime: ProviderExecutor,
  step: ShoppingSearchWorkflowStep,
  options: ExecuteShoppingWorkflowPlanOptions,
  envelope: WorkflowResumeEnvelope
): Promise<ProviderAggregateResult> => {
  const input = step.input;
  return runtime.search({
    query: input.query,
    limit: input.limit,
    ...(input.filters ? { filters: input.filters } : {})
  }, options.buildStepOptions(step, envelope));
};

const executeFetchStep = async (
  runtime: ProviderExecutor,
  step: ShoppingFetchWorkflowStep,
  options: ExecuteShoppingWorkflowPlanOptions,
  envelope: WorkflowResumeEnvelope
): Promise<ProviderAggregateResult> => {
  return runtime.fetch({
    url: step.input.url
  }, options.buildStepOptions(step, envelope));
};

export const executeShoppingWorkflowPlan = async (
  runtime: ProviderExecutor,
  plan: CompiledShoppingExecutionPlan,
  options: ExecuteShoppingWorkflowPlanOptions
): Promise<ShoppingWorkflowExecutionResult> => {
  let checkpointState: ShoppingWorkflowCheckpointState = {
    completed_step_ids: [...plan.checkpointState.completed_step_ids],
    step_results_by_id: { ...plan.checkpointState.step_results_by_id }
  };
  let trace = [...(options.trace ?? [])];
  let stepIndex = 0;
  let lastCheckpoint = buildCheckpoint(
    checkpointState,
    plan.plan.steps[0] ?? {
      id: "shopping:execute",
      kind: "search",
      input: {
        providerId: plan.compiled.effectiveProviderIds[0] ?? "shopping/unknown",
        query: plan.compiled.query,
        limit: 0
      }
    },
    0
  );

  const runSteps = async (steps: ShoppingWorkflowExecutionStep[]): Promise<void> => {
    for (const step of steps) {
      const currentStepIndex = stepIndex;
      stepIndex += 1;

      if (checkpointState.completed_step_ids.includes(step.id)) {
        getCheckpointedResult(checkpointState, step.id);
        lastCheckpoint = buildCheckpoint(checkpointState, step, currentStepIndex);
        trace = appendTrace(trace, "resume", "step_reused", {
          stepId: step.id,
          stepKind: step.kind,
          providerId: step.input.providerId
        });
        continue;
      }

      trace = appendTrace(trace, "execute", "step_started", {
        stepId: step.id,
        stepKind: step.kind,
        providerId: step.input.providerId
      });
      const checkpoint = buildCheckpoint(checkpointState, step, currentStepIndex);
      const preSuspendTrace = appendTrace(trace, "execute", "pre_suspend_checkpoint", {
        stepId: step.id,
        stepKind: step.kind,
        providerId: step.input.providerId,
        completedSteps: checkpointState.completed_step_ids.length
      });
      const envelope = buildWorkflowResumeEnvelope(
        "shopping",
        plan.input as unknown as JsonValue,
        {
          checkpoint,
          trace: preSuspendTrace
        }
      );
      const result = step.kind === "search"
        ? await executeSearchStep(runtime, step, options, envelope)
        : await executeFetchStep(runtime, step, options, envelope);
      checkpointState = markStepCompleted(checkpointState, step.id, result);
      options.observeResult?.(result);
      trace = appendTrace(preSuspendTrace, "execute", "step_completed", {
        stepId: step.id,
        stepKind: step.kind,
        providerId: step.input.providerId,
        records: result.records.length,
        failures: result.failures.length
      });
      lastCheckpoint = buildCheckpoint(checkpointState, step, currentStepIndex);
    }
  };

  await runSteps(plan.plan.steps);

  const fetchSteps = deriveShoppingFetchSteps(plan.compiled, checkpointState);
  if (fetchSteps.length > 0) {
    trace = appendTrace(trace, "execute", "tactical_decision", {
      reason: "selective_fetch_recovery",
      fetchSteps: fetchSteps.length,
      providers: fetchSteps.map((step) => step.input.providerId)
    });
  }
  await runSteps(fetchSteps);

  return {
    runs: buildProviderRuns(plan, checkpointState, fetchSteps),
    checkpoint: lastCheckpoint,
    trace
  };
};
