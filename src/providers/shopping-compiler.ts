import { createHash } from "crypto";
import { canonicalizeUrl } from "./web/crawler";
import { isLikelyOfferRecord } from "./shopping-postprocess";
import { compileShoppingWorkflow, type CompiledShoppingWorkflow } from "./shopping-workflow";
import { getShoppingProviderProfile } from "./shopping";
import type { ProviderAggregateResult, JsonValue, NormalizedRecord, ProviderFailureEntry, ProviderSource } from "./types";
import type { ShoppingRunInput } from "./workflows";
import type { WorkflowCheckpoint, WorkflowPlan, WorkflowPlanStep, WorkflowResumeEnvelope } from "./workflow-contracts";

const DEFAULT_SHOPPING_SEARCH_LIMIT = 8;
const SEARCH_INDEX_RETRIEVAL_PATHS = new Set(["shopping:search:index", "shopping:search:link"]);

export type ShoppingWorkflowStepKind = "search" | "fetch";

export type ShoppingSearchStepInput = {
  providerId: string;
  query: string;
  limit: number;
  filters?: Record<string, JsonValue>;
};

export type ShoppingFetchStepInput = {
  providerId: string;
  url: string;
};

export type ShoppingSearchWorkflowStep = WorkflowPlanStep & {
  kind: "search";
  input: ShoppingSearchStepInput;
};

export type ShoppingFetchWorkflowStep = WorkflowPlanStep & {
  kind: "fetch";
  input: ShoppingFetchStepInput;
};

export type ShoppingWorkflowExecutionStep = (
  | ShoppingSearchWorkflowStep
  | ShoppingFetchWorkflowStep
) & {
  kind: ShoppingWorkflowStepKind;
};

export type ShoppingCheckpointStepResult = ProviderAggregateResult;

export type ShoppingWorkflowCheckpointState = {
  completed_step_ids: string[];
  step_results_by_id: Record<string, ShoppingCheckpointStepResult>;
};

export type CompiledShoppingExecutionPlan = {
  input: ShoppingRunInput;
  compiled: CompiledShoppingWorkflow;
  plan: WorkflowPlan & {
    steps: ShoppingWorkflowExecutionStep[];
  };
  checkpointState: ShoppingWorkflowCheckpointState;
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

const emptyCheckpointState = (): ShoppingWorkflowCheckpointState => ({
  completed_step_ids: [],
  step_results_by_id: {}
});

export const createShoppingSearchStepId = (providerId: string): string => `search:${providerId}`;

export const createShoppingFetchStepId = (providerId: string, url: string): string => (
  `fetch:${providerId}:${createHash("sha1").update(canonicalizeUrl(url)).digest("hex").slice(0, 16)}`
);

export const serializeShoppingCheckpointState = (
  state: ShoppingWorkflowCheckpointState
): Record<string, JsonValue> => ({
  completed_step_ids: [...state.completed_step_ids],
  step_results_by_id: state.step_results_by_id as unknown as Record<string, JsonValue>
});

export const readShoppingCheckpointState = (
  checkpoint?: WorkflowCheckpoint | null
): ShoppingWorkflowCheckpointState => {
  const state = checkpoint?.state;
  if (state === undefined || state === null) {
    return emptyCheckpointState();
  }
  if (!isJsonRecord(state)) {
    throw new Error("Shopping workflow checkpoint state must be a record.");
  }

  const completedStepIds = state.completed_step_ids;
  if (!Array.isArray(completedStepIds) || !completedStepIds.every((entry) => typeof entry === "string")) {
    throw new Error("Shopping workflow checkpoint state is missing valid completed_step_ids.");
  }

  const rawResults = state.step_results_by_id;
  if (!isJsonRecord(rawResults)) {
    throw new Error("Shopping workflow checkpoint state is missing valid step_results_by_id.");
  }

  const stepResultsById: Record<string, ShoppingCheckpointStepResult> = {};
  for (const [stepId, result] of Object.entries(rawResults)) {
    if (!isProviderAggregateResult(result)) {
      throw new Error(`Shopping workflow checkpoint state contains an invalid result for ${stepId}.`);
    }
    stepResultsById[stepId] = result;
  }

  return {
    completed_step_ids: [...completedStepIds],
    step_results_by_id: stepResultsById
  };
};

const buildSearchFilters = (compiled: CompiledShoppingWorkflow): Record<string, JsonValue> | undefined => {
  const filters: Record<string, JsonValue> = {};
  if (typeof compiled.budget === "number") {
    filters.budget = compiled.budget;
  }
  if (compiled.region) {
    filters.region = compiled.region;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
};

const hasProviderOwnedDomain = (providerId: string, url: string): boolean => {
  const profile = getShoppingProviderProfile(providerId);
  if (!profile || profile.domains.length === 0) {
    return false;
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return profile.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
};

const collectRecordLinkCandidates = (record: NormalizedRecord): string[] => {
  const links = Array.isArray(record.attributes.links)
    ? record.attributes.links.filter((entry): entry is string => typeof entry === "string")
    : [];
  return links.map((entry) => canonicalizeUrl(entry));
};

const collectProviderCandidateUrls = (
  providerId: string,
  records: NormalizedRecord[]
): string[] => {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const record of records) {
    const retrievalPath = typeof record.attributes.retrievalPath === "string"
      ? record.attributes.retrievalPath
      : "";
    const maybeRecordUrl = typeof record.url === "string" && !SEARCH_INDEX_RETRIEVAL_PATHS.has(retrievalPath)
      ? [canonicalizeUrl(record.url)]
      : [];
    const maybeLinkedUrls = collectRecordLinkCandidates(record);

    for (const candidate of [...maybeRecordUrl, ...maybeLinkedUrls]) {
      if (!/^https?:\/\//i.test(candidate)) {
        continue;
      }
      if (!hasProviderOwnedDomain(providerId, candidate)) {
        continue;
      }
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      candidates.push(candidate);
    }
  }

  return candidates;
};

export const deriveShoppingFetchSteps = (
  compiled: CompiledShoppingWorkflow,
  checkpointState: ShoppingWorkflowCheckpointState
): ShoppingWorkflowExecutionStep[] => {
  return compiled.effectiveProviderIds.flatMap((providerId) => {
    if (!getShoppingProviderProfile(providerId)?.domains.length) {
      return [];
    }

    const searchStepId = createShoppingSearchStepId(providerId);
    if (!checkpointState.completed_step_ids.includes(searchStepId)) {
      return [];
    }

    const searchResult = checkpointState.step_results_by_id[searchStepId];
    if (!searchResult || searchResult.failures.length > 0) {
      return [];
    }
    if (searchResult.records.some((record) => isLikelyOfferRecord(record))) {
      return [];
    }

    const candidateUrl = collectProviderCandidateUrls(providerId, searchResult.records)[0];
    if (!candidateUrl) {
      return [];
    }

    return [{
      id: createShoppingFetchStepId(providerId, candidateUrl),
      kind: "fetch",
      policy: {
        sources: ["shopping"],
        providers: [providerId]
      },
      input: {
        providerId,
        url: candidateUrl
      }
    }];
  });
};

export const compileShoppingExecutionPlan = (args: {
  input: ShoppingRunInput;
  envelope?: WorkflowResumeEnvelope | null;
  now?: Date;
  getDegradedProviders?: (providerIds: string[]) => ReadonlySet<string>;
}): CompiledShoppingExecutionPlan => {
  const compiled = compileShoppingWorkflow(args.input, {
    now: args.now,
    getDegradedProviders: args.getDegradedProviders
  });
  const checkpointState = readShoppingCheckpointState(args.envelope?.checkpoint ?? null);
  const filters = buildSearchFilters(compiled);
  const searchSteps: ShoppingWorkflowExecutionStep[] = compiled.effectiveProviderIds.map((providerId) => ({
    id: createShoppingSearchStepId(providerId),
    kind: "search",
    budget: {
      maxResults: DEFAULT_SHOPPING_SEARCH_LIMIT
    },
    policy: {
      sources: ["shopping"],
      providers: [providerId]
    },
    input: {
      providerId,
      query: compiled.query,
      limit: DEFAULT_SHOPPING_SEARCH_LIMIT,
      ...(filters ? { filters } : {})
    }
  }));

  return {
    input: args.input,
    compiled,
    checkpointState,
    plan: {
      kind: "shopping",
      steps: searchSteps
    }
  };
};
