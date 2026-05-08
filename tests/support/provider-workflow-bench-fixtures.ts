import { readFile, stat } from "fs/promises";
import { basename, dirname, join } from "path";
import { performance } from "perf_hooks";
import {
  runInspiredesignWorkflow,
  runProductVideoWorkflow,
  runResearchWorkflow,
  runShoppingWorkflow,
  type ProviderExecutor,
  type ReferenceRetrievalPort
} from "../../src/providers/workflows";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderSource
} from "../../src/providers/types";

export const PROVIDER_WORKFLOW_BASELINE_NOW = "2026-05-07T23:08:56.000Z";

export type WorkflowBaselineName = "research" | "shopping" | "product-video" | "inspiredesign";
export type ArtifactResponsePathKey = "artifact_path";
type WorkflowOutput = Awaited<ReturnType<typeof runResearchWorkflow>>;

export interface WorkflowBaselineScenario {
  workflow: WorkflowBaselineName;
  contractFact: string;
  failureCase: string;
}

export interface WorkflowBaselineMetric {
  workflow: WorkflowBaselineName;
  durationMs: number;
  artifactPath: string;
  artifactRoot: string;
  namespace: string;
  responsePathKey: ArtifactResponsePathKey;
  manifestFiles: string[];
  fileCount: number;
}

export interface FailureArtifactMetric {
  workflow: WorkflowBaselineName;
  expectedNamespace: WorkflowBaselineName;
  artifactDirectoryExists: boolean;
  errorMessage: string;
  auxiliaryFetchCalls?: number;
}

export interface ProviderWorkflowBaselineSuite {
  generatedAt: string;
  artifactRoot: string;
  scenarios: WorkflowBaselineScenario[];
  metrics: WorkflowBaselineMetric[];
  failureArtifacts: FailureArtifactMetric[];
}

export const WORKFLOW_BASELINE_SCENARIOS: WorkflowBaselineScenario[] = [
  {
    workflow: "research",
    contractFact: ".opendevbrowser/research/<run-id> with artifact_path in json mode",
    failureCase: "no usable records should throw before artifact write"
  },
  {
    workflow: "shopping",
    contractFact: ".opendevbrowser/shopping/<run-id> with artifact_path in json mode",
    failureCase: "invalid provider selection should throw before artifact write"
  },
  {
    workflow: "product-video",
    contractFact: ".opendevbrowser/product-video/<run-id> with artifact_path in json mode",
    failureCase: "invalid product target should throw before product artifact write"
  },
  {
    workflow: "inspiredesign",
    contractFact: ".opendevbrowser/inspiredesign/<run-id> with artifact_path in json mode",
    failureCase: "invalid reference URL should throw before artifact write"
  }
];

const timestamp = "2026-05-06T12:00:00.000Z";

const makeAggregate = (overrides: Partial<ProviderAggregateResult> = {}): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: { requestId: "provider-workflow-baseline", ts: PROVIDER_WORKFLOW_BASELINE_NOW },
  partial: false,
  failures: [],
  metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
  sourceSelection: "web",
  providerOrder: ["web/default"],
  ...overrides
});

const makeRecord = (overrides: Partial<NormalizedRecord>): NormalizedRecord => ({
  id: "baseline-record",
  source: "web",
  provider: "web/default",
  url: "https://example.com/baseline",
  title: "Baseline record",
  content: "Concrete baseline content for workflow instrumentation.",
  timestamp,
  confidence: 0.9,
  attributes: {},
  ...overrides
});

const makeShoppingOffer = (provider: string): NormalizedRecord => makeRecord({
  id: "baseline-shopping-offer",
  source: "shopping",
  provider,
  url: "https://example.com/baseline-monitor",
  title: "Baseline USB-C Monitor",
  content: "$199.00 in stock",
  attributes: {
    shopping_offer: {
      provider,
      product_id: "baseline-monitor",
      title: "Baseline USB-C Monitor",
      url: "https://example.com/baseline-monitor",
      price: { amount: 199, currency: "USD", retrieved_at: timestamp },
      shipping: { amount: 0, currency: "USD", notes: "free" },
      availability: "in_stock",
      rating: 4.7,
      reviews_count: 128
    }
  }
});

const makeProductRecord = (): NormalizedRecord => makeRecord({
  id: "baseline-product-detail",
  source: "shopping",
  provider: "shopping/amazon",
  url: "https://example.com/baseline-monitor",
  title: "Baseline USB-C Monitor",
  content: "Slim display. Single cable setup. Durable travel stand.",
  attributes: {
    links: [],
    shopping_offer: {
      provider: "shopping/amazon",
      product_id: "baseline-monitor",
      title: "Baseline USB-C Monitor",
      url: "https://example.com/baseline-monitor",
      price: { amount: 199, currency: "USD", retrieved_at: timestamp },
      availability: "in_stock"
    }
  }
});

const makeReferenceRecord = (url: string): NormalizedRecord => makeRecord({
  id: "baseline-inspiredesign-reference",
  url,
  title: "Reference landing page",
  content: "Editorial hero, grounded product story, strong visual hierarchy."
});

const readManifestFiles = async (artifactPath: string): Promise<string[]> => {
  const manifestRaw = await readFile(join(artifactPath, "bundle-manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as { files?: JsonValue };
  return Array.isArray(manifest.files)
    ? manifest.files.filter((file): file is string => typeof file === "string")
    : [];
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const getArtifactPath = (
  output: WorkflowOutput,
  key: ArtifactResponsePathKey
): string => {
  const value = output[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string artifact path.`);
  }
  return value;
};

const toMetric = async (
  workflow: WorkflowBaselineName,
  key: ArtifactResponsePathKey,
  output: WorkflowOutput,
  durationMs: number
): Promise<WorkflowBaselineMetric> => {
  const artifactPath = getArtifactPath(output, key);
  const manifestFiles = await readManifestFiles(artifactPath);
  return {
    workflow,
    durationMs,
    artifactPath,
    artifactRoot: dirname(dirname(artifactPath)),
    namespace: basename(dirname(artifactPath)),
    responsePathKey: key,
    manifestFiles,
    fileCount: manifestFiles.length
  };
};

const timedMetric = async (
  workflow: WorkflowBaselineName,
  key: ArtifactResponsePathKey,
  run: () => Promise<WorkflowOutput>
): Promise<WorkflowBaselineMetric> => {
  const start = performance.now();
  const output = await run();
  return toMetric(workflow, key, output, performance.now() - start);
};

const createRuntime = (): ProviderExecutor => ({
  search: async (_input, options) => {
    const source = options?.source ?? "web";
    if (source === "shopping") {
      const provider = options?.providerIds?.[0] ?? "shopping/amazon";
      return makeAggregate({
        records: [makeShoppingOffer(provider)],
        sourceSelection: "shopping",
        providerOrder: [provider]
      });
    }
    return makeAggregate({
      records: [makeRecord({ source, provider: `${source}/baseline` })],
      sourceSelection: source,
      providerOrder: [`${source}/baseline`]
    });
  },
  fetch: async (input) => {
    if (input.url.includes("baseline-monitor")) {
      return makeAggregate({
        records: [makeProductRecord()],
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"]
      });
    }
    return makeAggregate({ records: [makeReferenceRecord(input.url)] });
  }
});

const createReferenceRuntime = (runtime: ProviderExecutor): ReferenceRetrievalPort => ({
  fetch: runtime.fetch
});

export const runInvalidProductTargetBaseline = async (artifactRoot: string): Promise<FailureArtifactMetric> => {
  let auxiliaryFetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    auxiliaryFetchCalls += 1;
    return new Response(new Uint8Array([1, 2, 3]));
  };
  try {
    const runtime = createRuntime();
    runtime.fetch = async () => makeAggregate({
      sourceSelection: "web",
      providerOrder: ["web/default"],
      records: [makeRecord({
        id: "baseline-invalid-product",
        source: "web",
        provider: "web/default",
        url: "https://www.shoott.com/headshots",
        title: "Shoott | 404",
        content: "Error 404 We can’t seem to find the page you were looking for.",
        attributes: {
          status: 404,
          links: ["https://cdn.example.com/not-found.jpg"]
        }
      })]
    });
    await runProductVideoWorkflow(runtime, {
      product_url: "https://www.shoott.com/headshots",
      output_dir: artifactRoot,
      include_all_images: true,
      include_screenshots: true,
      include_copy: true
    });
    throw new Error("Invalid product target unexpectedly succeeded.");
  } catch (error) {
    return {
      workflow: "product-video",
      expectedNamespace: "product-video",
      artifactDirectoryExists: await pathExists(join(artifactRoot, "product-video")),
      auxiliaryFetchCalls,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  } finally {
    globalThis.fetch = previousFetch;
  }
};

const runResearchFailureBaseline = async (artifactRoot: string): Promise<FailureArtifactMetric> => {
  const runtime = createRuntime();
  runtime.search = async () => makeAggregate({ records: [] });
  try {
    await runResearchWorkflow(runtime, {
      topic: "empty provider results",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-08T00:00:00.000Z",
      sourceSelection: "web",
      mode: "json",
      outputDir: artifactRoot
    });
    throw new Error("Research failure baseline unexpectedly succeeded.");
  } catch (error) {
    return {
      workflow: "research",
      expectedNamespace: "research",
      artifactDirectoryExists: await pathExists(join(artifactRoot, "research")),
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
};

const runShoppingFailureBaseline = async (artifactRoot: string): Promise<FailureArtifactMetric> => {
  try {
    await runShoppingWorkflow(createRuntime(), {
      query: "portable USB-C monitor",
      providers: ["shopping/missing"],
      mode: "json",
      outputDir: artifactRoot
    });
    throw new Error("Shopping failure baseline unexpectedly succeeded.");
  } catch (error) {
    return {
      workflow: "shopping",
      expectedNamespace: "shopping",
      artifactDirectoryExists: await pathExists(join(artifactRoot, "shopping")),
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
};

const runInspiredesignFailureBaseline = async (artifactRoot: string): Promise<FailureArtifactMetric> => {
  try {
    await runInspiredesignWorkflow(createReferenceRuntime(createRuntime()), {
      brief: "Invalid reference validation",
      urls: ["not-a-url"],
      mode: "json",
      outputDir: artifactRoot
    });
    throw new Error("Inspiredesign failure baseline unexpectedly succeeded.");
  } catch (error) {
    return {
      workflow: "inspiredesign",
      expectedNamespace: "inspiredesign",
      artifactDirectoryExists: await pathExists(join(artifactRoot, "inspiredesign")),
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
};

const runFailureBaselines = async (artifactRoot: string): Promise<FailureArtifactMetric[]> => Promise.all([
  runResearchFailureBaseline(join(artifactRoot, "invalid-research")),
  runShoppingFailureBaseline(join(artifactRoot, "invalid-shopping")),
  runInvalidProductTargetBaseline(join(artifactRoot, "invalid-product-video")),
  runInspiredesignFailureBaseline(join(artifactRoot, "invalid-inspiredesign"))
]);

export const runProviderWorkflowBaselineSuite = async (
  artifactRoot: string
): Promise<ProviderWorkflowBaselineSuite> => {
  const runtime = createRuntime();
  const referenceRuntime = createReferenceRuntime(runtime);
  const metrics = [
    await timedMetric("research", "artifact_path", () => runResearchWorkflow(runtime, {
      topic: "provider workflow instrumentation",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-08T00:00:00.000Z",
      sourceSelection: "web",
      mode: "json",
      outputDir: artifactRoot,
      ttlHours: 72
    })),
    await timedMetric("shopping", "artifact_path", () => runShoppingWorkflow(runtime, {
      query: "portable USB-C monitor",
      providers: ["shopping/amazon"],
      sort: "lowest_price",
      mode: "json",
      outputDir: artifactRoot,
      ttlHours: 72
    })),
    await timedMetric("product-video", "artifact_path", () => runProductVideoWorkflow(runtime, {
      product_url: "https://example.com/baseline-monitor",
      include_screenshots: false,
      include_all_images: false,
      include_copy: true,
      output_dir: artifactRoot,
      ttl_hours: 72
    })),
    await timedMetric("inspiredesign", "artifact_path", () => runInspiredesignWorkflow(referenceRuntime, {
      brief: "Design a premium workflow instrumentation dashboard",
      urls: ["https://example.com/reference"],
      captureMode: "off",
      mode: "json",
      outputDir: artifactRoot,
      ttlHours: 72
    }))
  ];
  return {
    generatedAt: new Date().toISOString(),
    artifactRoot,
    scenarios: WORKFLOW_BASELINE_SCENARIOS,
    metrics,
    failureArtifacts: await runFailureBaselines(artifactRoot)
  };
};
