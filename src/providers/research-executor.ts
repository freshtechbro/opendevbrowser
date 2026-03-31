import { canonicalizeUrl } from "./web/crawler";
import {
  buildWorkflowResumeEnvelope,
  type WorkflowCheckpoint,
  type WorkflowResumeEnvelope,
  type WorkflowTraceEntry
} from "./workflow-contracts";
import {
  createResearchFetchStepId,
  serializeResearchCheckpointState,
  type CompiledResearchExecutionPlan,
  type ResearchFetchWorkflowStep,
  type ResearchSearchWorkflowStep,
  type ResearchWorkflowCheckpointState,
  type ResearchWorkflowExecutionStep
} from "./research-compiler";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderRunOptions,
  ProviderSource
} from "./types";
import type { ProviderExecutor } from "./workflows";

const RESEARCH_WEB_SEARCH_FETCH_PATHS = new Set<string>([
  "web:search:index",
  "social:search:index"
]);

export type ResearchWorkflowSearchRun = {
  source: ProviderSource;
  result: ProviderAggregateResult;
};

export type ResearchWorkflowFollowUpRun = {
  source: "web";
  url: string;
  result: ProviderAggregateResult;
};

export type ResearchWorkflowExecutionResult = {
  searchRuns: ResearchWorkflowSearchRun[];
  followUpRuns: ResearchWorkflowFollowUpRun[];
  checkpoint: WorkflowCheckpoint;
  trace: WorkflowTraceEntry[];
};

export type ExecuteResearchWorkflowPlanOptions = {
  trace?: WorkflowTraceEntry[];
  observeResult?: (result: ProviderAggregateResult) => void;
  buildStepOptions: (
    step: ResearchWorkflowExecutionStep,
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
  checkpointState: ResearchWorkflowCheckpointState,
  stepId: string
): ProviderAggregateResult => {
  const result = checkpointState.step_results_by_id[stepId];
  if (!result) {
    throw new Error(`Research workflow checkpoint is missing result for completed step ${stepId}.`);
  }
  return result;
};

const buildCheckpoint = (
  checkpointState: ResearchWorkflowCheckpointState,
  step: ResearchWorkflowExecutionStep,
  stepIndex: number
): WorkflowCheckpoint => ({
  stage: "execute",
  stepId: step.id,
  stepIndex,
  state: serializeResearchCheckpointState(checkpointState),
  updatedAt: new Date().toISOString()
});

const markStepCompleted = (
  checkpointState: ResearchWorkflowCheckpointState,
  stepId: string,
  result: ProviderAggregateResult
): ResearchWorkflowCheckpointState => ({
  completed_step_ids: checkpointState.completed_step_ids.includes(stepId)
    ? checkpointState.completed_step_ids
    : [...checkpointState.completed_step_ids, stepId],
  step_results_by_id: {
    ...checkpointState.step_results_by_id,
    [stepId]: result
  }
});

const isValidHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const resolveResearchWebFetchCandidates = (
  records: NormalizedRecord[],
  limit: number
): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const retrievalPath = typeof record.attributes.retrievalPath === "string"
      ? record.attributes.retrievalPath
      : "";
    if (!RESEARCH_WEB_SEARCH_FETCH_PATHS.has(retrievalPath)) {
      continue;
    }
    const rawUrl = typeof record.url === "string" ? canonicalizeUrl(record.url) : "";
    if (!rawUrl) {
      continue;
    }

    let resolvedUrl = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (/duckduckgo\.com$/i.test(parsed.hostname) && parsed.pathname === "/l") {
        const redirect = parsed.searchParams.get("uddg");
        if (typeof redirect === "string" && redirect.length > 0) {
          resolvedUrl = canonicalizeUrl(redirect);
        }
      }
    } catch {
      continue;
    }

    if (!resolvedUrl || !isValidHttpUrl(resolvedUrl) || /duckduckgo\.com/i.test(resolvedUrl) || seen.has(resolvedUrl)) {
      continue;
    }
    seen.add(resolvedUrl);
    candidates.push(resolvedUrl);
    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
};

const buildSearchRuns = (
  steps: readonly ResearchSearchWorkflowStep[],
  checkpointState: ResearchWorkflowCheckpointState
): ResearchWorkflowSearchRun[] => {
  return steps.flatMap((step) => {
    const result = checkpointState.step_results_by_id[step.id];
    if (!result) {
      return [];
    }
    return [{
      source: step.input.source,
      result
    }];
  });
};

const deriveResearchFetchSteps = (
  plan: CompiledResearchExecutionPlan,
  searchRuns: ResearchWorkflowSearchRun[]
): ResearchFetchWorkflowStep[] => {
  return resolveResearchWebFetchCandidates(
    searchRuns.flatMap((run) => run.result.records),
    plan.compiled.followUpFetchLimit
  ).map((url) => ({
    id: createResearchFetchStepId(url),
    kind: "fetch",
    policy: {
      sources: ["web"]
    },
    input: {
      source: "web",
      url
    }
  }));
};

const buildFollowUpRuns = (
  steps: ResearchFetchWorkflowStep[],
  checkpointState: ResearchWorkflowCheckpointState
): ResearchWorkflowFollowUpRun[] => {
  return steps.flatMap((step) => {
    const result = checkpointState.step_results_by_id[step.id];
    if (!result) {
      return [];
    }
    return [{
      source: "web",
      url: step.input.url,
      result
    }];
  });
};

const executeSearchStep = async (
  runtime: ProviderExecutor,
  step: ResearchSearchWorkflowStep,
  options: ExecuteResearchWorkflowPlanOptions,
  envelope: WorkflowResumeEnvelope
): Promise<ProviderAggregateResult> => {
  return runtime.search({
    query: step.input.query,
    limit: step.input.limit,
    filters: step.input.filters
  }, options.buildStepOptions(step, envelope));
};

const executeFetchStep = async (
  runtime: ProviderExecutor,
  step: ResearchFetchWorkflowStep,
  options: ExecuteResearchWorkflowPlanOptions,
  envelope: WorkflowResumeEnvelope
): Promise<ProviderAggregateResult> => {
  return runtime.fetch({
    url: step.input.url
  }, options.buildStepOptions(step, envelope));
};

export const executeResearchWorkflowPlan = async (
  runtime: ProviderExecutor,
  plan: CompiledResearchExecutionPlan,
  options: ExecuteResearchWorkflowPlanOptions
): Promise<ResearchWorkflowExecutionResult> => {
  let checkpointState: ResearchWorkflowCheckpointState = {
    completed_step_ids: [...plan.checkpointState.completed_step_ids],
    step_results_by_id: { ...plan.checkpointState.step_results_by_id }
  };
  let trace = [...(options.trace ?? [])];
  let stepIndex = 0;
  let lastCheckpoint = buildCheckpoint(
    checkpointState,
    plan.plan.steps[0] ?? {
      id: "research:execute",
      kind: "search",
      input: {
        source: plan.compiled.resolvedSources[0] ?? "web",
        query: plan.compiled.topic,
        limit: 0,
        filters: {
          include_engagement: false,
          timebox_from: plan.compiled.timebox.from,
          timebox_to: plan.compiled.timebox.to
        }
      }
    },
    0
  );

  const runSteps = async (steps: ResearchWorkflowExecutionStep[]): Promise<void> => {
    for (const step of steps) {
      const currentStepIndex = stepIndex;
      stepIndex += 1;

      if (checkpointState.completed_step_ids.includes(step.id)) {
        getCheckpointedResult(checkpointState, step.id);
        lastCheckpoint = buildCheckpoint(checkpointState, step, currentStepIndex);
        trace = appendTrace(trace, "resume", "step_reused", {
          stepId: step.id,
          stepKind: step.kind,
          source: step.input.source,
          ...(step.kind === "fetch" ? { url: step.input.url } : {})
        });
        continue;
      }

      trace = appendTrace(trace, "execute", "step_started", {
        stepId: step.id,
        stepKind: step.kind,
        source: step.input.source,
        ...(step.kind === "fetch" ? { url: step.input.url } : {})
      });
      const checkpoint = buildCheckpoint(checkpointState, step, currentStepIndex);
      const preSuspendTrace = appendTrace(trace, "execute", "pre_suspend_checkpoint", {
        stepId: step.id,
        stepKind: step.kind,
        source: step.input.source,
        ...(step.kind === "fetch" ? { url: step.input.url } : {}),
        completedSteps: checkpointState.completed_step_ids.length
      });
      const envelope = buildWorkflowResumeEnvelope(
        "research",
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
        source: step.input.source,
        ...(step.kind === "fetch" ? { url: step.input.url } : {}),
        records: result.records.length,
        failures: result.failures.length
      });
      lastCheckpoint = buildCheckpoint(checkpointState, step, currentStepIndex);
    }
  };

  await runSteps(plan.plan.steps);

  const searchRuns = buildSearchRuns(plan.plan.steps, checkpointState);
  const followUpSteps = deriveResearchFetchSteps(plan, searchRuns);
  if (followUpSteps.length > 0) {
    trace = appendTrace(trace, "execute", "tactical_decision", {
      reason: "selective_web_follow_up",
      fetchSteps: followUpSteps.length,
      urls: followUpSteps.map((step) => step.input.url)
    });
  }
  await runSteps(followUpSteps);

  return {
    searchRuns: buildSearchRuns(plan.plan.steps, checkpointState),
    followUpRuns: buildFollowUpRuns(followUpSteps, checkpointState),
    checkpoint: lastCheckpoint,
    trace
  };
};
