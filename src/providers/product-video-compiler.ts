import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderFailureEntry,
  ProviderSource
} from "./types";
import type { ProductVideoRunInput } from "./workflows";
import type { WorkflowCheckpoint, WorkflowPlan, WorkflowPlanStep, WorkflowResumeEnvelope } from "./workflow-contracts";

export const PRODUCT_VIDEO_STEP_IDS = {
  normalizeInput: "product_video:normalize_input",
  resolveProductUrl: "product_video:resolve_product_url",
  fetchProductDetail: "product_video:fetch_product_detail",
  extractProductData: "product_video:extract_product_data",
  assembleArtifacts: "product_video:assemble_artifacts"
} as const;

export type ProductVideoWorkflowStepKind =
  | "normalize_input"
  | "resolve_product_url"
  | "fetch_product_detail"
  | "extract_product_data"
  | "assemble_artifacts";

export type ProductVideoNormalizeStep = WorkflowPlanStep & {
  id: typeof PRODUCT_VIDEO_STEP_IDS.normalizeInput;
  kind: "normalize_input";
  input: {
    has_product_url: boolean;
    has_product_name: boolean;
    has_provider_hint: boolean;
  };
};

export type ProductVideoResolveUrlStep = WorkflowPlanStep & {
  id: typeof PRODUCT_VIDEO_STEP_IDS.resolveProductUrl;
  kind: "resolve_product_url";
  input: {
    product_name: string;
    provider_hint?: string;
  };
};

export type ProductVideoFetchDetailStep = WorkflowPlanStep & {
  id: typeof PRODUCT_VIDEO_STEP_IDS.fetchProductDetail;
  kind: "fetch_product_detail";
  input: {
    product_url?: string;
    provider_hint?: string;
    timeout_ms?: number;
  };
};

export type ProductVideoExtractStep = WorkflowPlanStep & {
  id: typeof PRODUCT_VIDEO_STEP_IDS.extractProductData;
  kind: "extract_product_data";
  input: Record<string, JsonValue>;
};

export type ProductVideoAssembleArtifactsStep = WorkflowPlanStep & {
  id: typeof PRODUCT_VIDEO_STEP_IDS.assembleArtifacts;
  kind: "assemble_artifacts";
  input: {
    include_screenshots: boolean;
    include_all_images: boolean;
    include_copy: boolean;
  };
};

export type ProductVideoWorkflowExecutionStep = (
  | ProductVideoNormalizeStep
  | ProductVideoResolveUrlStep
  | ProductVideoFetchDetailStep
  | ProductVideoExtractStep
  | ProductVideoAssembleArtifactsStep
) & {
  kind: ProductVideoWorkflowStepKind;
};

export type ProductVideoWorkflowCheckpointState = {
  completed_step_ids: string[];
  resolved_product_url?: string;
  resolved_provider_hint?: string;
  detail_result?: ProviderAggregateResult;
};

type NormalizedProductVideoRunInput = ProductVideoRunInput & {
  include_screenshots: boolean;
  include_all_images: boolean;
  include_copy: boolean;
};

export type CompiledProductVideoExecutionPlan = {
  input: NormalizedProductVideoRunInput;
  compiled: {
    productUrl?: string;
    productName?: string;
    providerHint?: string;
    includeScreenshots: boolean;
    includeAllImages: boolean;
    includeCopy: boolean;
    outputDir?: string;
    ttlHours?: number;
    timeoutMs?: number;
    resolutionRequired: boolean;
  };
  plan: WorkflowPlan & {
    steps: ProductVideoWorkflowExecutionStep[];
  };
  checkpointState: ProductVideoWorkflowCheckpointState;
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

const emptyCheckpointState = (): ProductVideoWorkflowCheckpointState => ({
  completed_step_ids: []
});

const isValidHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeProductVideoInput = (input: ProductVideoRunInput): NormalizedProductVideoRunInput => {
  const productUrl = input.product_url?.trim();
  const productName = input.product_name?.trim();
  const providerHint = input.provider_hint?.trim();

  if (!productUrl && !productName) {
    throw new Error("product_url or product_name is required");
  }
  if (productUrl && !isValidHttpUrl(productUrl)) {
    throw new Error("product_url must be an http(s) URL");
  }

  return {
    ...input,
    ...(productUrl ? { product_url: productUrl } : {}),
    ...(productName ? { product_name: productName } : {}),
    ...(providerHint ? { provider_hint: providerHint } : {}),
    include_screenshots: input.include_screenshots ?? true,
    include_all_images: input.include_all_images ?? true,
    include_copy: input.include_copy ?? true
  };
};

export const serializeProductVideoCheckpointState = (
  state: ProductVideoWorkflowCheckpointState
): Record<string, JsonValue> => ({
  completed_step_ids: [...state.completed_step_ids],
  ...(state.resolved_product_url ? { resolved_product_url: state.resolved_product_url } : {}),
  ...(state.resolved_provider_hint ? { resolved_provider_hint: state.resolved_provider_hint } : {}),
  ...(state.detail_result ? { detail_result: state.detail_result as unknown as Record<string, JsonValue> } : {})
});

export const readProductVideoCheckpointState = (
  checkpoint?: WorkflowCheckpoint | null
): ProductVideoWorkflowCheckpointState => {
  const state = checkpoint?.state;
  if (state === undefined || state === null) {
    return emptyCheckpointState();
  }
  if (!isJsonRecord(state)) {
    throw new Error("Product-video workflow checkpoint state must be a record.");
  }

  const completedStepIds = state.completed_step_ids;
  if (!Array.isArray(completedStepIds) || !completedStepIds.every((entry) => typeof entry === "string")) {
    throw new Error("Product-video workflow checkpoint state is missing valid completed_step_ids.");
  }

  const resolvedProductUrl = state.resolved_product_url;
  if (resolvedProductUrl !== undefined && typeof resolvedProductUrl !== "string") {
    throw new Error("Product-video workflow checkpoint state has an invalid resolved_product_url.");
  }

  const resolvedProviderHint = state.resolved_provider_hint;
  if (resolvedProviderHint !== undefined && typeof resolvedProviderHint !== "string") {
    throw new Error("Product-video workflow checkpoint state has an invalid resolved_provider_hint.");
  }

  const detailResult = state.detail_result;
  if (detailResult !== undefined && !isProviderAggregateResult(detailResult)) {
    throw new Error("Product-video workflow checkpoint state has an invalid detail_result.");
  }

  return {
    completed_step_ids: [...completedStepIds],
    ...(resolvedProductUrl ? { resolved_product_url: resolvedProductUrl } : {}),
    ...(resolvedProviderHint ? { resolved_provider_hint: resolvedProviderHint } : {}),
    ...(detailResult ? { detail_result: detailResult } : {})
  };
};

const buildProductVideoPlanSteps = (
  input: NormalizedProductVideoRunInput
): ProductVideoWorkflowExecutionStep[] => {
  const steps: ProductVideoWorkflowExecutionStep[] = [
    {
      id: PRODUCT_VIDEO_STEP_IDS.normalizeInput,
      kind: "normalize_input",
      input: {
        has_product_url: typeof input.product_url === "string",
        has_product_name: typeof input.product_name === "string",
        has_provider_hint: typeof input.provider_hint === "string"
      }
    }
  ];

  if (!input.product_url && input.product_name) {
    steps.push({
      id: PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
      kind: "resolve_product_url",
      input: {
        product_name: input.product_name,
        ...(input.provider_hint ? { provider_hint: input.provider_hint } : {})
      }
    });
  }

  steps.push(
    {
      id: PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
      kind: "fetch_product_detail",
      input: {
        ...(input.product_url ? { product_url: input.product_url } : {}),
        ...(input.provider_hint ? { provider_hint: input.provider_hint } : {}),
        ...(typeof input.timeoutMs === "number" ? { timeout_ms: input.timeoutMs } : {})
      }
    },
    {
      id: PRODUCT_VIDEO_STEP_IDS.extractProductData,
      kind: "extract_product_data",
      input: {}
    },
    {
      id: PRODUCT_VIDEO_STEP_IDS.assembleArtifacts,
      kind: "assemble_artifacts",
      input: {
        include_screenshots: input.include_screenshots,
        include_all_images: input.include_all_images,
        include_copy: input.include_copy
      }
    }
  );

  return steps;
};

export const compileProductVideoExecutionPlan = (args: {
  input: ProductVideoRunInput;
  envelope?: WorkflowResumeEnvelope | null;
}): CompiledProductVideoExecutionPlan => {
  const input = normalizeProductVideoInput(args.input);
  const checkpointState = readProductVideoCheckpointState(args.envelope?.checkpoint);
  return {
    input,
    compiled: {
      productUrl: input.product_url,
      productName: input.product_name,
      providerHint: input.provider_hint,
      includeScreenshots: input.include_screenshots,
      includeAllImages: input.include_all_images,
      includeCopy: input.include_copy,
      outputDir: input.output_dir,
      ttlHours: input.ttl_hours,
      timeoutMs: input.timeoutMs,
      resolutionRequired: !input.product_url
    },
    plan: {
      kind: "product_video",
      steps: buildProductVideoPlanSteps(input),
      meta: {
        resolution_required: !input.product_url,
        include_screenshots: input.include_screenshots,
        include_all_images: input.include_all_images,
        include_copy: input.include_copy
      }
    },
    checkpointState
  };
};
