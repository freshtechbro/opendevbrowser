import { createHash } from "crypto";
import { canonicalizeUrl } from "./web/crawler";
import { SHOPPING_PROVIDER_IDS } from "./shopping";
import { enforceShoppingLegalReviewGate } from "./shopping-workflow";
import { resolveTimebox, type ResolvedTimebox } from "./timebox";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderFailureEntry,
  ProviderSelection,
  ProviderSource
} from "./types";
import type { ResearchRunInput } from "./workflows";
import type { WorkflowCheckpoint, WorkflowPlan, WorkflowPlanStep, WorkflowResumeEnvelope } from "./workflow-contracts";

const RESEARCH_AUTO_SOURCES: ProviderSource[] = ["web", "community", "social"];
const RESEARCH_ALL_SOURCES: ProviderSource[] = [...RESEARCH_AUTO_SOURCES];
const DEFAULT_RESEARCH_SEARCH_LIMIT = 10;
export const RESEARCH_WEB_SEARCH_FETCH_LIMIT = 3;

export type ResearchWorkflowStepKind = "search" | "fetch";

export type ResearchSearchStepInput = {
  source: ProviderSource;
  query: string;
  limit: number;
  filters: Record<string, JsonValue>;
};

export type ResearchFetchStepInput = {
  source: "web";
  url: string;
};

export type ResearchSearchWorkflowStep = WorkflowPlanStep & {
  kind: "search";
  input: ResearchSearchStepInput;
};

export type ResearchFetchWorkflowStep = WorkflowPlanStep & {
  kind: "fetch";
  input: ResearchFetchStepInput;
};

export type ResearchWorkflowExecutionStep = (
  | ResearchSearchWorkflowStep
  | ResearchFetchWorkflowStep
) & {
  kind: ResearchWorkflowStepKind;
};

export type ResearchCheckpointStepResult = ProviderAggregateResult;

export type ResearchWorkflowCheckpointState = {
  completed_step_ids: string[];
  step_results_by_id: Record<string, ResearchCheckpointStepResult>;
};

export type CompiledResearchExecutionPlan = {
  input: ResearchRunInput;
  compiled: {
    topic: string;
    sourceSelection: ProviderSelection;
    resolvedSources: ProviderSource[];
    timebox: ResolvedTimebox;
    searchLimit: number;
    followUpFetchLimit: number;
    allowFollowUpWebFetch: boolean;
    autoExcludedProviders: string[];
  };
  plan: WorkflowPlan & {
    steps: ResearchSearchWorkflowStep[];
  };
  checkpointState: ResearchWorkflowCheckpointState;
};

const isJsonRecord = (value: unknown): value is Record<string, JsonValue> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === "number" && Number.isFinite(value)
);

const isProviderSource = (value: unknown): value is ProviderSource => (
  value === "web" || value === "community" || value === "social" || value === "shopping"
);

const isTraceContext = (value: unknown): value is ProviderAggregateResult["trace"] => (
  isJsonRecord(value)
  && typeof value.requestId === "string"
  && typeof value.ts === "string"
  && (value.sessionId === undefined || typeof value.sessionId === "string")
  && (value.targetId === undefined || typeof value.targetId === "string")
  && (value.provider === undefined || typeof value.provider === "string")
);

const isProviderError = (value: unknown): boolean => (
  isJsonRecord(value)
  && typeof value.code === "string"
  && typeof value.message === "string"
  && typeof value.retryable === "boolean"
  && (value.reasonCode === undefined || typeof value.reasonCode === "string")
  && (value.provider === undefined || typeof value.provider === "string")
  && (value.source === undefined || isProviderSource(value.source))
  && (value.details === undefined || isJsonRecord(value.details))
);

const isNormalizedRecord = (value: unknown): value is NormalizedRecord => (
  isJsonRecord(value)
  && typeof value.id === "string"
  && isProviderSource(value.source)
  && typeof value.provider === "string"
  && (value.url === undefined || typeof value.url === "string")
  && (value.title === undefined || typeof value.title === "string")
  && (value.content === undefined || typeof value.content === "string")
  && typeof value.timestamp === "string"
  && isFiniteNumber(value.confidence)
  && isJsonRecord(value.attributes)
);

const isProviderFailureEntry = (value: unknown): value is ProviderFailureEntry => (
  isJsonRecord(value)
  && typeof value.provider === "string"
  && isProviderSource(value.source)
  && isProviderError(value.error)
);

const isProviderAggregateResult = (value: unknown): value is ProviderAggregateResult => (
  isJsonRecord(value)
  && typeof value.ok === "boolean"
  && Array.isArray(value.records)
  && value.records.every((entry) => isNormalizedRecord(entry))
  && isTraceContext(value.trace)
  && typeof value.partial === "boolean"
  && Array.isArray(value.failures)
  && value.failures.every((entry) => isProviderFailureEntry(entry))
  && isJsonRecord(value.metrics)
  && isFiniteNumber(value.metrics.attempted)
  && isFiniteNumber(value.metrics.succeeded)
  && isFiniteNumber(value.metrics.failed)
  && isFiniteNumber(value.metrics.retries)
  && isFiniteNumber(value.metrics.latencyMs)
  && typeof value.sourceSelection === "string"
  && Array.isArray(value.providerOrder)
  && value.providerOrder.every((entry) => typeof entry === "string")
  && (value.meta === undefined || isJsonRecord(value.meta))
  && (value.diagnostics === undefined || isJsonRecord(value.diagnostics))
  && (value.error === undefined || isProviderError(value.error))
);

const emptyCheckpointState = (): ResearchWorkflowCheckpointState => ({
  completed_step_ids: [],
  step_results_by_id: {}
});

const toProviderSource = (providerId: string): ProviderSource | null => {
  if (providerId.startsWith("web/")) return "web";
  if (providerId.startsWith("community/")) return "community";
  if (providerId.startsWith("social/")) return "social";
  if (providerId.startsWith("shopping/")) return "shopping";
  return null;
};

export const createResearchSearchStepId = (source: ProviderSource): string => `search:${source}`;

export const createResearchFetchStepId = (url: string): string => (
  `fetch:web:${createHash("sha1").update(canonicalizeUrl(url)).digest("hex").slice(0, 16)}`
);

export const serializeResearchCheckpointState = (
  state: ResearchWorkflowCheckpointState
): Record<string, JsonValue> => ({
  completed_step_ids: [...state.completed_step_ids],
  step_results_by_id: state.step_results_by_id as unknown as Record<string, JsonValue>
});

export const readResearchCheckpointState = (
  checkpoint?: WorkflowCheckpoint | null
): ResearchWorkflowCheckpointState => {
  const state = checkpoint?.state;
  if (state === undefined || state === null) {
    return emptyCheckpointState();
  }
  if (!isJsonRecord(state)) {
    throw new Error("Research workflow checkpoint state must be a record.");
  }

  const completedStepIds = state.completed_step_ids;
  if (!Array.isArray(completedStepIds) || !completedStepIds.every((entry) => typeof entry === "string")) {
    throw new Error("Research workflow checkpoint state is missing valid completed_step_ids.");
  }

  const rawResults = state.step_results_by_id;
  if (!isJsonRecord(rawResults)) {
    throw new Error("Research workflow checkpoint state is missing valid step_results_by_id.");
  }

  const stepResultsById: Record<string, ResearchCheckpointStepResult> = {};
  for (const [stepId, result] of Object.entries(rawResults)) {
    if (!isProviderAggregateResult(result)) {
      throw new Error(`Research workflow checkpoint state contains an invalid result for ${stepId}.`);
    }
    stepResultsById[stepId] = result;
  }

  return {
    completed_step_ids: [...completedStepIds],
    step_results_by_id: stepResultsById
  };
};

export const resolveResearchSources = (input: ResearchRunInput): {
  sourceSelection: ProviderSelection;
  resolved: ProviderSource[];
} => {
  if (input.sources && input.sources.length > 0) {
    return {
      sourceSelection: input.sourceSelection ?? "auto",
      resolved: [...new Set(input.sources)]
    };
  }

  const selection = input.sourceSelection ?? "auto";
  if (selection === "all") {
    return { sourceSelection: selection, resolved: RESEARCH_ALL_SOURCES };
  }
  if (selection === "auto") {
    return { sourceSelection: selection, resolved: RESEARCH_AUTO_SOURCES };
  }
  return {
    sourceSelection: selection,
    resolved: [selection]
  };
};

const resolveResearchAutoExcludedProviders = (
  sourceSelection: ProviderSelection,
  resolvedSources: ProviderSource[],
  degradedProviders: ReadonlySet<string>
): string[] => {
  if (sourceSelection !== "auto") {
    return [];
  }
  const sourceSet = new Set(resolvedSources);
  return [...degradedProviders]
    .filter((provider) => {
      const source = toProviderSource(provider);
      return source !== null && sourceSet.has(source);
    })
    .sort((left, right) => left.localeCompare(right));
};

export const compileResearchExecutionPlan = (args: {
  input: ResearchRunInput;
  envelope?: WorkflowResumeEnvelope | null;
  now?: Date;
  getDegradedProviders?: () => ReadonlySet<string>;
}): CompiledResearchExecutionPlan => {
  const topic = args.input.topic?.trim();
  if (!topic) {
    throw new Error("topic is required");
  }

  const { sourceSelection, resolved } = resolveResearchSources(args.input);
  const now = args.now ?? new Date();
  const timebox = resolveTimebox({
    days: args.input.days,
    from: args.input.from,
    to: args.input.to,
    now
  });
  if (resolved.includes("shopping")) {
    enforceShoppingLegalReviewGate(SHOPPING_PROVIDER_IDS, now);
  }

  const searchLimit = args.input.limitPerSource ?? DEFAULT_RESEARCH_SEARCH_LIMIT;
  const autoExcludedProviders = resolveResearchAutoExcludedProviders(
    sourceSelection,
    resolved,
    args.getDegradedProviders?.() ?? new Set<string>()
  );
  const checkpointState = readResearchCheckpointState(args.envelope?.checkpoint ?? null);
  const searchSteps: ResearchSearchWorkflowStep[] = resolved.map((source) => ({
    id: createResearchSearchStepId(source),
    kind: "search",
    budget: {
      maxResults: searchLimit
    },
    policy: {
      sources: [source]
    },
    input: {
      source,
      query: topic,
      limit: searchLimit,
      filters: {
        include_engagement: args.input.includeEngagement ?? false,
        timebox_from: timebox.from,
        timebox_to: timebox.to
      }
    }
  }));

  return {
    input: args.input,
    compiled: {
      topic,
      sourceSelection,
      resolvedSources: resolved,
      timebox,
      searchLimit,
      followUpFetchLimit: Math.max(1, Math.min(searchLimit, RESEARCH_WEB_SEARCH_FETCH_LIMIT)),
      allowFollowUpWebFetch: resolved.includes("web"),
      autoExcludedProviders
    },
    checkpointState,
    plan: {
      kind: "research",
      steps: searchSteps
    }
  };
};
